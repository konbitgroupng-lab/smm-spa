-- Phase 2: server-side availability and validated booking holds.
--
-- One rule set (private.slot_block_reason) decides whether a therapist can take
-- a slot. The availability listing and the hold request both use it, so a hold
-- can only be created on a slot the listing would offer. The Phase 1 exclusion
-- constraints and guard triggers remain the final safeguard.

-- ---------------------------------------------------------------------------
-- The rule set
-- ---------------------------------------------------------------------------
-- Returns null when the therapist is free for the slot, otherwise the reason.
-- All day/time rules are evaluated in the business timezone.
create function private.slot_block_reason(
  p_therapist_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_blocked_until timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.business_settings;
  v_local_start timestamp;
  v_local_end timestamp;
  v_dow integer;
  v_start_time time;
  v_end_time time;
begin
  select * into v_settings from public.business_settings;
  if not found then
    return 'not_configured';
  end if;

  v_local_start := p_starts_at at time zone v_settings.timezone;
  v_local_end := p_ends_at at time zone v_settings.timezone;
  v_dow := extract(dow from v_local_start);
  v_start_time := v_local_start::time;
  v_end_time := v_local_end::time;

  if p_starts_at < clock_timestamp() + make_interval(mins => v_settings.min_lead_minutes) then
    return 'too_soon';
  end if;
  if v_local_start::date > (clock_timestamp() at time zone v_settings.timezone)::date + v_settings.max_advance_days then
    return 'too_far';
  end if;

  -- Start times sit on the booking grid, counted from local midnight.
  if extract(second from v_start_time) <> 0
     or (extract(hour from v_start_time) * 60 + extract(minute from v_start_time))::integer
        % v_settings.slot_interval_minutes <> 0 then
    return 'off_grid';
  end if;

  -- The service must start and finish on the same day, inside opening hours.
  -- (The turnover buffer may run past closing; the treatment may not.)
  if v_local_end::date <> v_local_start::date or not exists (
    select 1 from public.business_hours bh
    where bh.day_of_week = v_dow and not bh.is_closed
      and bh.opens_at <= v_start_time and v_end_time <= bh.closes_at
  ) then
    return 'outside_business_hours';
  end if;

  if exists (
    select 1 from public.blackout_dates b
    where tstzrange(b.starts_at, b.ends_at) && tstzrange(p_starts_at, p_ends_at)
  ) then
    return 'blackout';
  end if;

  if not exists (
    select 1 from public.therapist_schedules s
    where s.therapist_id = p_therapist_id and s.day_of_week = v_dow
      and s.start_time <= v_start_time and v_end_time <= s.end_time
  ) then
    return 'outside_shift';
  end if;

  if exists (
    select 1 from public.therapist_breaks b
    where b.therapist_id = p_therapist_id and b.day_of_week = v_dow
      and b.start_time < v_end_time and v_start_time < b.end_time
  ) then
    return 'on_break';
  end if;

  if exists (
    select 1 from public.therapist_time_off o
    where o.therapist_id = p_therapist_id
      and tstzrange(o.starts_at, o.ends_at) && tstzrange(p_starts_at, p_ends_at)
  ) then
    return 'time_off';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.therapist_id = p_therapist_id
      and a.status in ('pending_payment', 'confirmed', 'completed')
      and tstzrange(a.starts_at, a.blocked_until) && tstzrange(p_starts_at, p_blocked_until)
  ) or exists (
    select 1 from public.booking_holds h
    where h.therapist_id = p_therapist_id
      and h.status = 'active'
      and h.expires_at > clock_timestamp()
      and tstzrange(h.starts_at, h.blocked_until) && tstzrange(p_starts_at, p_blocked_until)
  ) then
    return 'slot_taken';
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Availability listing (public, read-only)
-- ---------------------------------------------------------------------------
-- Free start times for a service on a local calendar date, per therapist.
-- Guests may call this directly: it reveals only which slots are free, never
-- schedules, customers or existing bookings.
create function public.get_available_slots(
  p_service_id uuid,
  p_date date,
  p_therapist_id uuid default null
)
returns table (therapist_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_settings public.business_settings;
  v_service public.services;
  v_duration interval;
  v_blocked interval;
begin
  select * into v_settings from public.business_settings;
  if not found then
    return;
  end if;
  select * into v_service from public.services s where s.id = p_service_id and s.is_active;
  if not found then
    return;
  end if;

  v_duration := make_interval(mins => v_service.duration_minutes);
  v_blocked := make_interval(mins => v_service.duration_minutes + v_service.buffer_minutes);

  return query
  select c.therapist_id, c.starts_at, c.starts_at + v_duration
  from (
    select t.id as therapist_id, t.sort_order,
           (p_date + make_interval(mins => g.minute)) at time zone v_settings.timezone as starts_at
    from public.therapists t
    join public.therapist_services ts on ts.therapist_id = t.id and ts.service_id = p_service_id
    join public.business_hours bh on bh.day_of_week = extract(dow from p_date)::integer and not bh.is_closed
    cross join generate_series(0, 1439, v_settings.slot_interval_minutes) as g (minute)
    where t.is_active
      and (p_therapist_id is null or t.id = p_therapist_id)
      and time '00:00' + make_interval(mins => g.minute) >= bh.opens_at
      and time '00:00' + make_interval(mins => g.minute) < bh.closes_at
  ) c
  where private.slot_block_reason(c.therapist_id, c.starts_at, c.starts_at + v_duration, c.starts_at + v_blocked) is null
  order by c.starts_at, c.sort_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- Validated hold request
-- ---------------------------------------------------------------------------
-- Reserves a slot after checking it against the rule set. With no therapist
-- given, assigns the free therapist with the fewest appointments that day.
-- p_replace_hold_token releases the guest's previous hold in the same
-- transaction, so one guest holds one slot at a time.
-- Raises slot_unavailable (SQLSTATE 23P01); DETAIL carries the reason.
create function public.request_booking_hold(
  p_service_id uuid,
  p_starts_at timestamptz,
  p_therapist_id uuid default null,
  p_location_type public.location_type default 'sanctuary',
  p_dispatch_zone_id uuid default null,
  p_replace_hold_token uuid default null
)
returns public.booking_holds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.business_settings;
  v_service public.services;
  v_ends_at timestamptz;
  v_blocked_until timestamptz;
  v_local_date date;
  v_candidate uuid;
  v_candidates integer := 0;
  v_reason text;
  v_hold public.booking_holds;
begin
  select * into v_settings from public.business_settings;
  if not found then
    raise exception 'not_configured' using errcode = 'P0001';
  end if;

  select * into v_service from public.services s where s.id = p_service_id and s.is_active;
  if not found then
    raise exception 'service_unavailable' using errcode = 'P0001';
  end if;

  if p_location_type = 'mobile' then
    if not exists (select 1 from public.dispatch_zones z where z.id = p_dispatch_zone_id and z.is_active) then
      raise exception 'dispatch_zone_required' using errcode = 'P0001';
    end if;
  else
    p_dispatch_zone_id := null;
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_minutes);
  v_blocked_until := v_ends_at + make_interval(mins => v_service.buffer_minutes);
  v_local_date := (p_starts_at at time zone v_settings.timezone)::date;

  -- Lock every candidate up front, in a fixed order, so two concurrent requests
  -- can never deadlock and the check below stays true until the insert.
  perform private.lock_therapist(c.id)
  from (
    select t.id
    from public.therapists t
    join public.therapist_services ts on ts.therapist_id = t.id and ts.service_id = p_service_id
    where t.is_active and (p_therapist_id is null or t.id = p_therapist_id)
    order by t.id
  ) c;

  if p_replace_hold_token is not null then
    update public.booking_holds set status = 'released'
     where hold_token = p_replace_hold_token and status = 'active';
  end if;

  for v_candidate in
    select t.id
    from public.therapists t
    join public.therapist_services ts on ts.therapist_id = t.id and ts.service_id = p_service_id
    where t.is_active and (p_therapist_id is null or t.id = p_therapist_id)
    order by (
      select count(*) from public.appointments a
      where a.therapist_id = t.id
        and a.status in ('pending_payment', 'confirmed', 'completed')
        and (a.starts_at at time zone v_settings.timezone)::date = v_local_date
    ), t.sort_order, t.id
  loop
    v_candidates := v_candidates + 1;
    v_reason := private.slot_block_reason(v_candidate, p_starts_at, v_ends_at, v_blocked_until);
    if v_reason is null then
      begin
        insert into public.booking_holds (
          service_id, therapist_id, starts_at, ends_at, blocked_until, expires_at,
          location_type, dispatch_zone_id
        )
        values (
          p_service_id, v_candidate, p_starts_at, v_ends_at, v_blocked_until,
          clock_timestamp() + make_interval(mins => v_settings.hold_minutes),
          p_location_type, p_dispatch_zone_id
        )
        returning * into v_hold;
        return v_hold;
      exception
        when exclusion_violation then
          v_reason := 'slot_taken';
      end;
    end if;
  end loop;

  if v_candidates = 0 then
    raise exception 'therapist_unavailable' using errcode = 'P0001';
  end if;
  raise exception 'slot_unavailable' using errcode = '23P01', detail = v_reason;
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer details and release
-- ---------------------------------------------------------------------------
-- Attaches guest contact details to a live hold. A guest whose email is already
-- on file is linked to that customer; the stored name and phone are left alone,
-- because an unauthenticated guest must not be able to rewrite customer records.
create function public.attach_customer_to_hold(
  p_hold_token uuid,
  p_full_name text,
  p_email text,
  p_phone text
)
returns public.booking_holds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_full_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := trim(coalesce(p_phone, ''));
  v_hold public.booking_holds;
  v_customer_id uuid;
begin
  if length(v_name) < 2 or length(v_name) > 120
     or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254
     or v_phone !~ '^\+?[0-9][0-9 ()-]{6,19}$' then
    raise exception 'invalid_customer' using errcode = 'P0001';
  end if;

  select * into v_hold
  from public.booking_holds h
  where h.hold_token = p_hold_token and h.status = 'active' and h.expires_at > clock_timestamp()
  for update;
  if not found then
    raise exception 'hold_expired' using errcode = 'P0001';
  end if;

  insert into public.customers (full_name, email, phone)
  values (v_name, v_email, v_phone)
  on conflict (lower(email)) do nothing
  returning id into v_customer_id;

  if v_customer_id is null then
    select c.id into v_customer_id from public.customers c where lower(c.email) = v_email;
  end if;

  update public.booking_holds set customer_id = v_customer_id where id = v_hold.id
  returning * into v_hold;
  return v_hold;
end;
$$;

-- Releases a hold the guest no longer wants. Returns false if it was not live.
create function public.release_booking_hold(p_hold_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.booking_holds set status = 'released'
   where hold_token = p_hold_token and status = 'active';
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting for the public booking endpoint
-- ---------------------------------------------------------------------------
-- Fixed-window counters. The key is an opaque hash supplied by the Edge
-- Function (never a raw IP address).
create table private.rate_limit_hits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (key, window_start)
);
alter table private.rate_limit_hits enable row level security;

-- Counts one attempt; returns false once the limit for the current window is exceeded.
create function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into private.rate_limit_hits as r (key, window_start)
  values (p_key, v_window)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Maintenance: sweep expired holds and old rate-limit counters every minute
-- ---------------------------------------------------------------------------
create function public.run_booking_maintenance()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released integer;
begin
  v_released := public.release_expired_booking_holds();
  delete from private.rate_limit_hits where window_start < clock_timestamp() - interval '1 day';
  return v_released;
end;
$$;

-- pg_cron exists on Supabase (hosted and local) but not in the in-process test
-- database, so scheduling is skipped where the extension is unavailable.
-- Correctness never depends on the sweep: expired holds already stop blocking.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('booking-maintenance', '* * * * *', 'select public.run_booking_maintenance()');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function private.slot_block_reason(uuid, timestamptz, timestamptz, timestamptz) from public;

revoke execute on function
  public.get_available_slots(uuid, date, uuid),
  public.request_booking_hold(uuid, timestamptz, uuid, public.location_type, uuid, uuid),
  public.attach_customer_to_hold(uuid, text, text, text),
  public.release_booking_hold(uuid),
  public.consume_rate_limit(text, integer, integer),
  public.run_booking_maintenance()
from public, anon, authenticated;

grant execute on function public.get_available_slots(uuid, date, uuid) to anon, authenticated, service_role;

grant execute on function
  public.request_booking_hold(uuid, timestamptz, uuid, public.location_type, uuid, uuid),
  public.attach_customer_to_hold(uuid, text, text, text),
  public.release_booking_hold(uuid),
  public.consume_rate_limit(text, integer, integer),
  public.run_booking_maintenance()
to service_role;
