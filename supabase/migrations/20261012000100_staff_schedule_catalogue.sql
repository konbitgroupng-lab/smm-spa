-- Phase 5c: schedule and catalogue management for staff.
--
--   1. One rule set, now in two parts: private.schedule_block_reason() holds
--      the opening-hours / blackout / shift / break / time-off checks, and
--      private.slot_block_reason() (availability, holds, payment re-checks,
--      rescheduling) calls it. Conflict detection uses the same function.
--   2. Conflicts: future appointments that the current schedule or catalogue
--      no longer allows are listed for staff, never cancelled. Live guest
--      reservations that would now fail are counted.
--   3. Every schedule and catalogue change goes through a function that takes
--      the schedule-rules lock exclusively, checks the version, applies the
--      change, and compares conflicts before and after. New conflicts refuse
--      the change unless staff confirm it with a reason; the acceptance is
--      audited. Direct writes to these tables are revoked.
--
-- Nothing here touches appointments, holds or payments: prices, durations
-- and buffers already on a booking or a started payment stay as they are.

-- =========================================================================
-- 1. The rule set, split
-- =========================================================================

-- The schedule part: is the therapist working, and the business open, for
-- the whole treatment? Null when yes, otherwise the first rule that fails.
create function private.schedule_block_reason(
  p_therapist_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_dow integer;
  v_start_time time;
  v_end_time time;
begin
  select bs.timezone into v_tz from public.business_settings bs;
  if not found then
    return 'not_configured';
  end if;

  v_local_start := p_starts_at at time zone v_tz;
  v_local_end := p_ends_at at time zone v_tz;
  v_dow := extract(dow from v_local_start);
  v_start_time := v_local_start::time;
  v_end_time := v_local_end::time;

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

  return null;
end;
$$;

-- Same checks, same order and same results as before (20261003000200):
-- booking-time rules, then the schedule part, then other reservations.
create or replace function private.slot_block_reason(
  p_therapist_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_blocked_until timestamptz,
  p_as_of timestamptz,
  p_ignore_hold_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.business_settings;
  v_local_start timestamp;
  v_start_time time;
  v_reason text;
begin
  select * into v_settings from public.business_settings;
  if not found then
    return 'not_configured';
  end if;

  v_local_start := p_starts_at at time zone v_settings.timezone;
  v_start_time := v_local_start::time;

  if p_starts_at < p_as_of + make_interval(mins => v_settings.min_lead_minutes) then
    return 'too_soon';
  end if;
  if v_local_start::date > (p_as_of at time zone v_settings.timezone)::date + v_settings.max_advance_days then
    return 'too_far';
  end if;

  -- Start times sit on the booking grid, counted from local midnight.
  if extract(second from v_start_time) <> 0
     or (extract(hour from v_start_time) * 60 + extract(minute from v_start_time))::integer
        % v_settings.slot_interval_minutes <> 0 then
    return 'off_grid';
  end if;

  v_reason := private.schedule_block_reason(p_therapist_id, p_starts_at, p_ends_at);
  if v_reason is not null then
    return v_reason;
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
      and h.id is distinct from p_ignore_hold_id
      and tstzrange(h.starts_at, h.blocked_until) && tstzrange(p_starts_at, p_blocked_until)
  ) then
    return 'slot_taken';
  end if;

  return null;
end;
$$;

-- =========================================================================
-- 2. Conflicts
-- =========================================================================

-- Future appointments the schedule or catalogue no longer allows. One row
-- per reason. Booking-time rules (notice, booking window, grid) apply only
-- when booking, so they are not conflicts for bookings already made.
create function private.appointment_conflicts()
returns table (appointment_id uuid, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, r.reason
  from public.appointments a
  join public.services s on s.id = a.service_id
  join public.therapists t on t.id = a.therapist_id
  left join public.dispatch_zones z on z.id = a.dispatch_zone_id
  cross join lateral (values
    (case when not s.is_active then 'service_inactive' end),
    (case when not t.is_active then 'therapist_inactive' end),
    (case when not exists (
       select 1 from public.therapist_services ts where ts.therapist_id = a.therapist_id and ts.service_id = a.service_id
     ) then 'therapist_service_removed' end),
    (case when a.location_type = 'mobile' and (z.id is null or not z.is_active) then 'zone_inactive' end),
    (private.schedule_block_reason(a.therapist_id, a.starts_at, a.ends_at))
  ) as r (reason)
  where a.status in ('pending_payment', 'confirmed')
    and a.starts_at > clock_timestamp()
    and r.reason is not null;
$$;

-- Live guest reservations whose payment the re-check would now refuse (and
-- flag for refund). The same checks record_payment_result() makes.
create function private.reservation_issues()
returns table (hold_id uuid, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id, x.reason
  from (
    select h.id, coalesce(
      case
        when not s.is_active then 'service_inactive'
        when h.ends_at <> h.starts_at + make_interval(mins => s.duration_minutes)
          or h.blocked_until <> h.ends_at + make_interval(mins => s.buffer_minutes) then 'service_changed'
        when not t.is_active then 'therapist_inactive'
        when not exists (
          select 1 from public.therapist_services ts where ts.therapist_id = h.therapist_id and ts.service_id = h.service_id
        ) then 'therapist_service_removed'
      end,
      private.schedule_block_reason(h.therapist_id, h.starts_at, h.ends_at)
    ) as reason
    from public.booking_holds h
    join public.services s on s.id = h.service_id
    join public.therapists t on t.id = h.therapist_id
    where h.status = 'active' and h.expires_at > clock_timestamp()
  ) x
  where x.reason is not null;
$$;

-- Every current conflict, as "id:reason" keys, for before/after comparison.
create function private.conflict_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'appointments', coalesce((select jsonb_agg(distinct c.appointment_id::text || ':' || c.reason) from private.appointment_conflicts() c), '[]'::jsonb),
    'holds', coalesce((select jsonb_agg(distinct r.hold_id::text || ':' || r.reason) from private.reservation_issues() r), '[]'::jsonb)
  );
$$;

-- An audit entry that is not a row change (here: conflicts staff accepted).
create function private.audit_note(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_reason text,
  p_context jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, actor_role, actor_kind, action, entity_type, entity_id, reason, context)
  values (
    (select auth.uid()),
    (select p.role from public.profiles p where p.id = (select auth.uid())),
    case when (select auth.uid()) is null then 'system' else 'staff' end,
    p_action, p_entity_type, p_entity_id, p_reason, coalesce(p_context, '{}'::jsonb)
  );
$$;

-- Called after a change, in the same transaction and under the schedule-rules
-- lock. Conflicts the change created refuse it (confirmation_required, with
-- the affected bookings in DETAIL as JSON) unless p_confirm is set; then a
-- reason is required and the acceptance is audited. Returns the new conflicts.
create function private.check_new_conflicts(
  p_before jsonb,
  p_confirm boolean,
  p_reason text,
  p_entity_type text,
  p_entity_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_after jsonb := private.conflict_snapshot();
  v_appointments jsonb;
  v_ids jsonb;
  v_holds integer;
begin
  with keys as (
    select split_part(k, ':', 1)::uuid as id, split_part(k, ':', 2) as reason
    from jsonb_array_elements_text(v_after -> 'appointments') as k
    where not ((p_before -> 'appointments') ? k)
  ),
  grouped as (
    select id, array_agg(reason order by reason) as reasons from keys group by id
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'reference', a.reference, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
      'service_name', s.name, 'therapist_name', t.display_name,
      'contact_name', coalesce(a.contact_name, c.full_name), 'reasons', to_jsonb(g.reasons)
    ) order by a.starts_at), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'reasons', to_jsonb(g.reasons)) order by a.starts_at), '[]'::jsonb)
  into v_appointments, v_ids
  from grouped g
  join public.appointments a on a.id = g.id
  join public.services s on s.id = a.service_id
  join public.therapists t on t.id = a.therapist_id
  join public.customers c on c.id = a.customer_id;

  select count(distinct split_part(k, ':', 1)) into v_holds
  from jsonb_array_elements_text(v_after -> 'holds') as k
  where not ((p_before -> 'holds') ? k);

  if jsonb_array_length(v_appointments) > 0 or v_holds > 0 then
    if not coalesce(p_confirm, false) then
      raise exception 'confirmation_required' using errcode = 'P0001',
        detail = jsonb_build_object('appointments', v_appointments, 'reservations', v_holds)::text;
    end if;
    -- No names or contact details in the audit: ids and reasons only.
    perform private.audit_note('schedule.conflicts_accepted', p_entity_type, p_entity_id,
      private.require_reason(p_reason), jsonb_build_object('appointments', v_ids, 'reservations', v_holds));
  end if;

  return jsonb_build_object('appointments', v_appointments, 'reservations', v_holds);
end;
$$;

-- Start of every schedule/catalogue change: role check, then the
-- schedule-rules lock, exclusively (payments and reschedules hold it shared),
-- then the conflicts as they stand.
create function private.begin_schedule_change()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  perform pg_advisory_xact_lock(private.schedule_rules_lock_key());
  return private.conflict_snapshot();
end;
$$;

-- Time-off notes may concern a therapist's health: audited without values.
insert into private.audit_personal_columns (entity_type, column_name) values ('therapist_time_off', 'reason');

-- =========================================================================
-- 3. Versions and input helpers
-- =========================================================================
-- Opening hours, a therapist's week, the services a therapist offers and a
-- package's contents have no single row to carry a version; their version is
-- a fingerprint of their current rows.

create function private.hours_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(coalesce(string_agg(concat_ws('|', bh.day_of_week, bh.is_closed, bh.opens_at, bh.closes_at), ';' order by bh.day_of_week), ''))
  from public.business_hours bh;
$$;

create function private.therapist_week_version(p_therapist_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(
    coalesce((select string_agg(concat_ws('|', s.day_of_week, s.start_time, s.end_time), ';' order by s.day_of_week, s.start_time, s.end_time)
              from public.therapist_schedules s where s.therapist_id = p_therapist_id), '')
    || '#' ||
    coalesce((select string_agg(concat_ws('|', b.day_of_week, b.start_time, b.end_time), ';' order by b.day_of_week, b.start_time, b.end_time)
              from public.therapist_breaks b where b.therapist_id = p_therapist_id), '')
  );
$$;

create function private.therapist_services_version(p_therapist_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(coalesce(string_agg(ts.service_id::text, ';' order by ts.service_id), ''))
  from public.therapist_services ts where ts.therapist_id = p_therapist_id;
$$;

create function private.package_items_version(p_package_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(coalesce(string_agg(i.service_id::text || '|' || i.sort_order, ';' order by i.sort_order, i.service_id), ''))
  from public.service_package_items i where i.package_id = p_package_id;
$$;

create function private.require_version(p_actual text, p_expected text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_expected is null or p_actual is distinct from p_expected then
    raise exception 'stale_record' using errcode = 'P0001';
  end if;
end;
$$;

-- "HH:MM" (or "HH:MM:SS") to a time; null when it is not one.
create function private.parse_time(p_value text)
returns time
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^\d{2}:\d{2}(:\d{2})?$' then
    return null;
  end if;
  return p_value::time;
exception
  when others then
    return null;
end;
$$;

-- A list of weekly periods ([{day_of_week, start_time, end_time}]): valid,
-- each starting before it ends, and none overlapping another on the same day.
create function private.valid_week_periods(p_periods jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_periods is null or jsonb_typeof(p_periods) <> 'array' or jsonb_array_length(p_periods) > 50 then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_periods) e
    where jsonb_typeof(e) <> 'object'
      or (e ->> 'day_of_week') !~ '^[0-6]$'
      or private.parse_time(e ->> 'start_time') is null
      or private.parse_time(e ->> 'end_time') is null
      or private.parse_time(e ->> 'start_time') >= private.parse_time(e ->> 'end_time')
  ) then
    return false;
  end if;
  return not exists (
    select 1
    from jsonb_array_elements(p_periods) with ordinality as a (e, i)
    join jsonb_array_elements(p_periods) with ordinality as b (e, i)
      on a.i < b.i and (a.e ->> 'day_of_week') = (b.e ->> 'day_of_week')
    where private.parse_time(a.e ->> 'start_time') < private.parse_time(b.e ->> 'end_time')
      and private.parse_time(b.e ->> 'start_time') < private.parse_time(a.e ->> 'end_time')
  );
end;
$$;

-- =========================================================================
-- 4. Schedule changes (owner/admin)
-- =========================================================================

-- The whole week of opening hours: [{day_of_week, is_closed, opens_at, closes_at}] x 7.
create function public.staff_set_business_hours(
  p_hours jsonb,
  p_expected_version text,
  p_reason text default null,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := private.begin_schedule_change();
  v_conflicts jsonb;
begin
  perform private.require_version(private.hours_version(), p_expected_version);
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) <> 7
     or (select count(distinct e ->> 'day_of_week') from jsonb_array_elements(p_hours) e where (e ->> 'day_of_week') ~ '^[0-6]$') <> 7
     or exists (
       select 1 from jsonb_array_elements(p_hours) e
       where jsonb_typeof(e -> 'is_closed') <> 'boolean'
          or (not (e ->> 'is_closed')::boolean and (
            private.parse_time(e ->> 'opens_at') is null or private.parse_time(e ->> 'closes_at') is null
            or private.parse_time(e ->> 'opens_at') >= private.parse_time(e ->> 'closes_at')))
     ) then
    raise exception 'invalid_schedule' using errcode = 'P0001';
  end if;

  perform private.audit_label('schedule.hours_changed', private.optional_reason(p_reason));
  insert into public.business_hours as bh (day_of_week, is_closed, opens_at, closes_at)
  select (e ->> 'day_of_week')::smallint, (e ->> 'is_closed')::boolean,
         case when (e ->> 'is_closed')::boolean then null else private.parse_time(e ->> 'opens_at') end,
         case when (e ->> 'is_closed')::boolean then null else private.parse_time(e ->> 'closes_at') end
  from jsonb_array_elements(p_hours) e
  on conflict (day_of_week) do update
     set is_closed = excluded.is_closed, opens_at = excluded.opens_at, closes_at = excluded.closes_at
   where (bh.is_closed, bh.opens_at, bh.closes_at) is distinct from (excluded.is_closed, excluded.opens_at, excluded.closes_at);
  perform private.audit_clear();

  v_conflicts := private.check_new_conflicts(v_before, p_confirm, p_reason, 'business_hours', null);
  return jsonb_build_object('version', private.hours_version(), 'conflicts', v_conflicts);
end;
$$;

-- A therapist's weekly shifts and breaks, replaced as a whole.
create function public.staff_set_therapist_week(
  p_therapist_id uuid,
  p_shifts jsonb,
  p_breaks jsonb,
  p_expected_version text,
  p_reason text default null,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := private.begin_schedule_change();
  v_conflicts jsonb;
begin
  if not exists (select 1 from public.therapists t where t.id = p_therapist_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_version(private.therapist_week_version(p_therapist_id), p_expected_version);
  if not private.valid_week_periods(p_shifts) or not private.valid_week_periods(p_breaks) then
    raise exception 'invalid_schedule' using errcode = 'P0001';
  end if;

  perform private.audit_label('schedule.therapist_week_changed', private.optional_reason(p_reason));
  -- Only rows that actually change are touched (and audited).
  delete from public.therapist_schedules s
   where s.therapist_id = p_therapist_id
     and not exists (
       select 1 from jsonb_array_elements(p_shifts) e
       where (e ->> 'day_of_week')::smallint = s.day_of_week
         and private.parse_time(e ->> 'start_time') = s.start_time and private.parse_time(e ->> 'end_time') = s.end_time);
  insert into public.therapist_schedules (therapist_id, day_of_week, start_time, end_time)
  select p_therapist_id, n.d, n.st, n.et
  from (select distinct (e ->> 'day_of_week')::smallint as d, private.parse_time(e ->> 'start_time') as st, private.parse_time(e ->> 'end_time') as et
        from jsonb_array_elements(p_shifts) e) n
  where not exists (
    select 1 from public.therapist_schedules s
    where s.therapist_id = p_therapist_id and s.day_of_week = n.d and s.start_time = n.st and s.end_time = n.et);

  delete from public.therapist_breaks b
   where b.therapist_id = p_therapist_id
     and not exists (
       select 1 from jsonb_array_elements(p_breaks) e
       where (e ->> 'day_of_week')::smallint = b.day_of_week
         and private.parse_time(e ->> 'start_time') = b.start_time and private.parse_time(e ->> 'end_time') = b.end_time);
  insert into public.therapist_breaks (therapist_id, day_of_week, start_time, end_time)
  select p_therapist_id, n.d, n.st, n.et
  from (select distinct (e ->> 'day_of_week')::smallint as d, private.parse_time(e ->> 'start_time') as st, private.parse_time(e ->> 'end_time') as et
        from jsonb_array_elements(p_breaks) e) n
  where not exists (
    select 1 from public.therapist_breaks b
    where b.therapist_id = p_therapist_id and b.day_of_week = n.d and b.start_time = n.st and b.end_time = n.et);
  perform private.audit_clear();

  v_conflicts := private.check_new_conflicts(v_before, p_confirm, p_reason, 'therapists', p_therapist_id::text);
  return jsonb_build_object('version', private.therapist_week_version(p_therapist_id), 'conflicts', v_conflicts);
end;
$$;

create function public.staff_add_time_off(
  p_therapist_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_note text default null,
  p_reason text default null,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := private.begin_schedule_change();
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_id uuid;
  v_conflicts jsonb;
begin
  if not exists (select 1 from public.therapists t where t.id = p_therapist_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at >= p_ends_at or p_ends_at <= clock_timestamp()
     or p_ends_at - p_starts_at > interval '366 days' or length(v_note) > 200 then
    raise exception 'invalid_period' using errcode = 'P0001';
  end if;
  perform private.audit_label('schedule.time_off_added', private.optional_reason(p_reason));
  insert into public.therapist_time_off (therapist_id, starts_at, ends_at, reason)
  values (p_therapist_id, p_starts_at, p_ends_at, v_note)
  returning id into v_id;
  perform private.audit_clear();
  v_conflicts := private.check_new_conflicts(v_before, p_confirm, p_reason, 'therapist_time_off', v_id::text);
  return jsonb_build_object('id', v_id, 'conflicts', v_conflicts);
end;
$$;

-- Removing time off or a blackout only frees time: it never creates conflicts.
create function public.staff_remove_time_off(p_time_off_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := private.begin_schedule_change();
begin
  perform private.audit_label('schedule.time_off_removed', private.optional_reason(p_reason));
  delete from public.therapist_time_off o where o.id = p_time_off_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.audit_clear();
end;
$$;

create function public.staff_add_blackout(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_note text default null,
  p_reason text default null,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := private.begin_schedule_change();
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_id uuid;
  v_conflicts jsonb;
begin
  if p_starts_at is null or p_ends_at is null or p_starts_at >= p_ends_at or p_ends_at <= clock_timestamp()
     or p_ends_at - p_starts_at > interval '366 days' or length(v_note) > 200 then
    raise exception 'invalid_period' using errcode = 'P0001';
  end if;
  perform private.audit_label('schedule.blackout_added', private.optional_reason(p_reason));
  insert into public.blackout_dates (starts_at, ends_at, reason) values (p_starts_at, p_ends_at, v_note)
  returning id into v_id;
  perform private.audit_clear();
  v_conflicts := private.check_new_conflicts(v_before, p_confirm, p_reason, 'blackout_dates', v_id::text);
  return jsonb_build_object('id', v_id, 'conflicts', v_conflicts);
end;
$$;

create function public.staff_remove_blackout(p_blackout_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := private.begin_schedule_change();
begin
  perform private.audit_label('schedule.blackout_removed', private.optional_reason(p_reason));
  delete from public.blackout_dates b where b.id = p_blackout_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.audit_clear();
end;
$$;

-- =========================================================================
-- 5. Catalogue changes (owner/admin)
-- =========================================================================

-- Create (p_service_id null) or edit a service or package. Fields:
-- slug, name, category, description, benefits[], duration_minutes,
-- buffer_minutes, price_minor, compare_at_price_minor, is_popular, is_active,
-- sort_order, and is_package (on creation only). Existing bookings keep
-- their own price, length and buffer; live reservations that a change makes
-- unpayable are reported (their payment would be flagged for refund).
create function public.staff_save_service(
  p_service_id uuid,
  p_expected_updated_at timestamptz,
  p_fields jsonb,
  p_reason text default null,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := private.begin_schedule_change();
  v_service public.services;
  v_slug text;
  v_name text;
  v_category text;
  v_description text;
  v_benefits text[];
  v_duration integer;
  v_buffer integer;
  v_price bigint;
  v_compare bigint;
  v_popular boolean;
  v_active boolean;
  v_sort integer;
  v_package boolean;
  v_conflicts jsonb;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'invalid_service' using errcode = 'P0001';
  end if;
  begin
    v_slug := lower(trim(coalesce(p_fields ->> 'slug', '')));
    v_name := trim(coalesce(p_fields ->> 'name', ''));
    v_category := trim(coalesce(p_fields ->> 'category', ''));
    v_description := trim(coalesce(p_fields ->> 'description', ''));
    v_benefits := array(
      select trim(b) from jsonb_array_elements_text(coalesce(p_fields -> 'benefits', '[]'::jsonb)) b where trim(b) <> ''
    );
    v_duration := (p_fields ->> 'duration_minutes')::integer;
    v_buffer := coalesce((p_fields ->> 'buffer_minutes')::integer, 0);
    v_price := (p_fields ->> 'price_minor')::bigint;
    v_compare := (p_fields ->> 'compare_at_price_minor')::bigint;
    v_popular := coalesce((p_fields ->> 'is_popular')::boolean, false);
    v_active := coalesce((p_fields ->> 'is_active')::boolean, true);
    v_sort := coalesce((p_fields ->> 'sort_order')::integer, 0);
    v_package := coalesce((p_fields ->> 'is_package')::boolean, false);
  exception
    when others then
      raise exception 'invalid_service' using errcode = 'P0001';
  end;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 60
     or length(v_name) < 2 or length(v_name) > 120 or length(v_category) > 60 or length(v_description) > 2000
     or cardinality(v_benefits) > 10 or exists (select 1 from unnest(v_benefits) b where length(b) > 200)
     or v_duration is null or v_duration not between 5 and 600 or v_buffer not between 0 and 240
     or v_price is null or v_price < 0 or v_price > 100000000
     or (v_compare is not null and (v_compare < v_price or v_compare > 100000000))
     or v_sort not between -100000 and 100000 then
    raise exception 'invalid_service' using errcode = 'P0001';
  end if;

  begin
    if p_service_id is null then
      perform private.audit_label('catalogue.service_created', private.optional_reason(p_reason));
      insert into public.services (slug, name, category, description, benefits, duration_minutes, buffer_minutes,
        price_minor, compare_at_price_minor, is_package, is_popular, is_active, sort_order)
      values (v_slug, v_name, v_category, v_description, v_benefits, v_duration, v_buffer,
        v_price, v_compare, v_package, v_popular, v_active, v_sort)
      returning * into v_service;
    else
      select * into v_service from public.services s where s.id = p_service_id for update;
      if not found then
        raise exception 'not_found' using errcode = 'P0001';
      end if;
      perform private.require_current(v_service.updated_at, p_expected_updated_at);
      perform private.audit_label('catalogue.service_updated', private.optional_reason(p_reason));
      update public.services
         set slug = v_slug, name = v_name, category = v_category, description = v_description, benefits = v_benefits,
             duration_minutes = v_duration, buffer_minutes = v_buffer, price_minor = v_price,
             compare_at_price_minor = v_compare, is_popular = v_popular, is_active = v_active, sort_order = v_sort
       where id = v_service.id
      returning * into v_service;
    end if;
  exception
    when unique_violation then
      raise exception 'slug_in_use' using errcode = 'P0001';
  end;
  perform private.audit_clear();

  v_conflicts := private.check_new_conflicts(v_before, p_confirm, p_reason, 'services', v_service.id::text);
  return jsonb_build_object('id', v_service.id, 'updated_at', v_service.updated_at, 'conflicts', v_conflicts);
end;
$$;

-- A package's contents: ordered list of (non-package) services. Contents do
-- not affect availability.
create function public.staff_set_package_items(
  p_package_id uuid,
  p_service_ids uuid[],
  p_expected_version text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  if not exists (select 1 from public.services s where s.id = p_package_id and s.is_package) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  -- Serialise edits of the same package.
  perform 1 from public.services s where s.id = p_package_id for update;
  perform private.require_version(private.package_items_version(p_package_id), p_expected_version);
  if p_service_ids is null or cardinality(p_service_ids) < 1 or cardinality(p_service_ids) > 10
     or (select count(distinct x) from unnest(p_service_ids) x) <> cardinality(p_service_ids)
     or (select count(*) from public.services s where s.id = any (p_service_ids) and not s.is_package and s.id <> p_package_id)
        <> cardinality(p_service_ids) then
    raise exception 'invalid_package' using errcode = 'P0001';
  end if;

  perform private.audit_label('catalogue.package_items_changed', private.optional_reason(p_reason));
  delete from public.service_package_items i where i.package_id = p_package_id and i.service_id <> all (p_service_ids);
  insert into public.service_package_items as i (package_id, service_id, sort_order)
  select p_package_id, x.id, x.n::integer from unnest(p_service_ids) with ordinality as x (id, n)
  on conflict (package_id, service_id) do update set sort_order = excluded.sort_order
   where i.sort_order is distinct from excluded.sort_order;
  perform private.audit_clear();
  return jsonb_build_object('version', private.package_items_version(p_package_id));
end;
$$;

-- Create (p_therapist_id null) or edit a therapist's public details and
-- active state. Fields: display_name, title, specialty, bio, is_active,
-- sort_order. Photos and login accounts are not managed here.
create function public.staff_save_therapist(
  p_therapist_id uuid,
  p_expected_updated_at timestamptz,
  p_fields jsonb,
  p_reason text default null,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := private.begin_schedule_change();
  v_therapist public.therapists;
  v_name text;
  v_title text;
  v_specialty text;
  v_bio text;
  v_active boolean;
  v_sort integer;
  v_conflicts jsonb;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'invalid_therapist' using errcode = 'P0001';
  end if;
  begin
    v_name := trim(coalesce(p_fields ->> 'display_name', ''));
    v_title := trim(coalesce(p_fields ->> 'title', ''));
    v_specialty := trim(coalesce(p_fields ->> 'specialty', ''));
    v_bio := trim(coalesce(p_fields ->> 'bio', ''));
    v_active := coalesce((p_fields ->> 'is_active')::boolean, true);
    v_sort := coalesce((p_fields ->> 'sort_order')::integer, 0);
  exception
    when others then
      raise exception 'invalid_therapist' using errcode = 'P0001';
  end;
  if length(v_name) < 2 or length(v_name) > 80 or length(v_title) > 80 or length(v_specialty) > 80
     or length(v_bio) > 2000 or v_sort not between -100000 and 100000 then
    raise exception 'invalid_therapist' using errcode = 'P0001';
  end if;

  if p_therapist_id is null then
    perform private.audit_label('catalogue.therapist_created', private.optional_reason(p_reason));
    insert into public.therapists (display_name, title, specialty, bio, is_active, sort_order)
    values (v_name, v_title, v_specialty, v_bio, v_active, v_sort)
    returning * into v_therapist;
  else
    select * into v_therapist from public.therapists t where t.id = p_therapist_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    perform private.require_current(v_therapist.updated_at, p_expected_updated_at);
    perform private.audit_label('catalogue.therapist_updated', private.optional_reason(p_reason));
    update public.therapists
       set display_name = v_name, title = v_title, specialty = v_specialty, bio = v_bio, is_active = v_active, sort_order = v_sort
     where id = v_therapist.id
    returning * into v_therapist;
  end if;
  perform private.audit_clear();

  v_conflicts := private.check_new_conflicts(v_before, p_confirm, p_reason, 'therapists', v_therapist.id::text);
  return jsonb_build_object('id', v_therapist.id, 'updated_at', v_therapist.updated_at, 'conflicts', v_conflicts);
end;
$$;

-- The services a therapist offers, replaced as a whole.
create function public.staff_set_therapist_services(
  p_therapist_id uuid,
  p_service_ids uuid[],
  p_expected_version text,
  p_reason text default null,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := private.begin_schedule_change();
  v_conflicts jsonb;
begin
  if not exists (select 1 from public.therapists t where t.id = p_therapist_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_version(private.therapist_services_version(p_therapist_id), p_expected_version);
  if p_service_ids is null
     or (select count(distinct x) from unnest(p_service_ids) x) <> cardinality(p_service_ids)
     or (select count(*) from public.services s where s.id = any (p_service_ids)) <> cardinality(p_service_ids) then
    raise exception 'invalid_services' using errcode = 'P0001';
  end if;

  perform private.audit_label('catalogue.therapist_services_changed', private.optional_reason(p_reason));
  delete from public.therapist_services ts where ts.therapist_id = p_therapist_id and ts.service_id <> all (p_service_ids);
  insert into public.therapist_services (therapist_id, service_id)
  select p_therapist_id, x from unnest(p_service_ids) x
  on conflict do nothing;
  perform private.audit_clear();

  v_conflicts := private.check_new_conflicts(v_before, p_confirm, p_reason, 'therapists', p_therapist_id::text);
  return jsonb_build_object('version', private.therapist_services_version(p_therapist_id), 'conflicts', v_conflicts);
end;
$$;

-- Create (p_zone_id null) or edit an in-home area. Fields: key, name,
-- fee_minor, is_active, sort_order. Bookings keep the travel fee they were
-- made with.
create function public.staff_save_zone(
  p_zone_id uuid,
  p_expected_updated_at timestamptz,
  p_fields jsonb,
  p_reason text default null,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := private.begin_schedule_change();
  v_zone public.dispatch_zones;
  v_key text;
  v_name text;
  v_fee bigint;
  v_active boolean;
  v_sort integer;
  v_conflicts jsonb;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'invalid_zone' using errcode = 'P0001';
  end if;
  begin
    v_key := lower(trim(coalesce(p_fields ->> 'key', '')));
    v_name := trim(coalesce(p_fields ->> 'name', ''));
    v_fee := (p_fields ->> 'fee_minor')::bigint;
    v_active := coalesce((p_fields ->> 'is_active')::boolean, true);
    v_sort := coalesce((p_fields ->> 'sort_order')::integer, 0);
  exception
    when others then
      raise exception 'invalid_zone' using errcode = 'P0001';
  end;
  if v_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_key) > 40 or length(v_name) < 2 or length(v_name) > 80
     or v_fee is null or v_fee < 0 or v_fee > 100000000 or v_sort not between -100000 and 100000 then
    raise exception 'invalid_zone' using errcode = 'P0001';
  end if;

  begin
    if p_zone_id is null then
      perform private.audit_label('catalogue.zone_created', private.optional_reason(p_reason));
      insert into public.dispatch_zones (key, name, fee_minor, is_active, sort_order)
      values (v_key, v_name, v_fee, v_active, v_sort)
      returning * into v_zone;
    else
      select * into v_zone from public.dispatch_zones z where z.id = p_zone_id for update;
      if not found then
        raise exception 'not_found' using errcode = 'P0001';
      end if;
      perform private.require_current(v_zone.updated_at, p_expected_updated_at);
      perform private.audit_label('catalogue.zone_updated', private.optional_reason(p_reason));
      update public.dispatch_zones
         set key = v_key, name = v_name, fee_minor = v_fee, is_active = v_active, sort_order = v_sort
       where id = v_zone.id
      returning * into v_zone;
    end if;
  exception
    when unique_violation then
      raise exception 'key_in_use' using errcode = 'P0001';
  end;
  perform private.audit_clear();

  v_conflicts := private.check_new_conflicts(v_before, p_confirm, p_reason, 'dispatch_zones', v_zone.id::text);
  return jsonb_build_object('id', v_zone.id, 'updated_at', v_zone.updated_at, 'conflicts', v_conflicts);
end;
$$;

-- =========================================================================
-- 6. Reads for the staff screens (owner/admin)
-- =========================================================================

create function public.staff_schedule_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  return jsonb_build_object(
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('day_of_week', bh.day_of_week, 'is_closed', bh.is_closed,
        'opens_at', to_char(bh.opens_at, 'HH24:MI'), 'closes_at', to_char(bh.closes_at, 'HH24:MI')) order by bh.day_of_week)
      from public.business_hours bh
    ), '[]'::jsonb),
    'hours_version', private.hours_version(),
    'therapists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.display_name, 'is_active', t.is_active,
        'week_version', private.therapist_week_version(t.id),
        'shifts', coalesce((select jsonb_agg(jsonb_build_object('day_of_week', s.day_of_week,
            'start_time', to_char(s.start_time, 'HH24:MI'), 'end_time', to_char(s.end_time, 'HH24:MI')) order by s.day_of_week, s.start_time)
          from public.therapist_schedules s where s.therapist_id = t.id), '[]'::jsonb),
        'breaks', coalesce((select jsonb_agg(jsonb_build_object('day_of_week', b.day_of_week,
            'start_time', to_char(b.start_time, 'HH24:MI'), 'end_time', to_char(b.end_time, 'HH24:MI')) order by b.day_of_week, b.start_time)
          from public.therapist_breaks b where b.therapist_id = t.id), '[]'::jsonb)
      ) order by t.sort_order, t.display_name)
      from public.therapists t
    ), '[]'::jsonb),
    'time_off', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'therapist_id', o.therapist_id, 'therapist_name', t.display_name,
        'starts_at', o.starts_at, 'ends_at', o.ends_at, 'note', o.reason) order by o.starts_at)
      from public.therapist_time_off o join public.therapists t on t.id = o.therapist_id
      where o.ends_at > clock_timestamp()
    ), '[]'::jsonb),
    'blackouts', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'note', b.reason) order by b.starts_at)
      from public.blackout_dates b where b.ends_at > clock_timestamp()
    ), '[]'::jsonb),
    'rules', (
      select jsonb_build_object('business_name', bs.business_name, 'timezone', bs.timezone, 'hold_minutes', bs.hold_minutes,
        'min_lead_minutes', bs.min_lead_minutes, 'max_advance_days', bs.max_advance_days,
        'slot_interval_minutes', bs.slot_interval_minutes, 'default_buffer_minutes', bs.default_buffer_minutes,
        'updated_at', bs.updated_at)
      from public.business_settings bs
    ),
    'conflict_count', (select count(distinct c.appointment_id) from private.appointment_conflicts() c)
  );
end;
$$;

create function public.staff_catalogue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  return jsonb_build_object(
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'slug', s.slug, 'name', s.name, 'category', s.category, 'description', s.description,
        'benefits', to_jsonb(s.benefits), 'duration_minutes', s.duration_minutes, 'buffer_minutes', s.buffer_minutes,
        'price_minor', s.price_minor, 'compare_at_price_minor', s.compare_at_price_minor, 'currency', s.currency,
        'is_package', s.is_package, 'is_popular', s.is_popular, 'is_active', s.is_active, 'sort_order', s.sort_order,
        'updated_at', s.updated_at,
        'future_appointments', (select count(*) from public.appointments a
          where a.service_id = s.id and a.status in ('pending_payment', 'confirmed') and a.starts_at > clock_timestamp()),
        'live_reservations', (select count(*) from public.booking_holds h
          where h.service_id = s.id and h.status = 'active' and h.expires_at > clock_timestamp()),
        'items', coalesce((select jsonb_agg(jsonb_build_object('service_id', i.service_id, 'name', x.name) order by i.sort_order)
          from public.service_package_items i join public.services x on x.id = i.service_id where i.package_id = s.id), '[]'::jsonb),
        'items_version', private.package_items_version(s.id)
      ) order by s.is_package, s.sort_order, s.name)
      from public.services s
    ), '[]'::jsonb),
    'therapists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'display_name', t.display_name, 'title', t.title, 'specialty', t.specialty, 'bio', t.bio,
        'is_active', t.is_active, 'sort_order', t.sort_order, 'updated_at', t.updated_at,
        'has_account', t.profile_id is not null,
        'service_ids', coalesce((select jsonb_agg(ts.service_id) from public.therapist_services ts where ts.therapist_id = t.id), '[]'::jsonb),
        'services_version', private.therapist_services_version(t.id),
        'future_appointments', (select count(*) from public.appointments a
          where a.therapist_id = t.id and a.status in ('pending_payment', 'confirmed') and a.starts_at > clock_timestamp())
      ) order by t.sort_order, t.display_name)
      from public.therapists t
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', z.id, 'key', z.key, 'name', z.name, 'fee_minor', z.fee_minor, 'is_active', z.is_active,
        'sort_order', z.sort_order, 'updated_at', z.updated_at,
        'future_appointments', (select count(*) from public.appointments a
          where a.dispatch_zone_id = z.id and a.status in ('pending_payment', 'confirmed') and a.starts_at > clock_timestamp())
      ) order by z.sort_order, z.name)
      from public.dispatch_zones z
    ), '[]'::jsonb)
  );
end;
$$;

-- Future appointments in conflict with the current schedule or catalogue.
create function public.staff_schedule_conflicts()
returns table (
  appointment_id uuid,
  reference text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  service_name text,
  therapist_id uuid,
  therapist_name text,
  contact_name text,
  location_type public.location_type,
  zone_name text,
  reasons text[],
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  return query
  with grouped as (
    select c.appointment_id as id, array_agg(distinct c.reason order by c.reason) as reasons
    from private.appointment_conflicts() c group by c.appointment_id
  )
  select a.id, a.reference, a.starts_at, a.ends_at, a.status, s.name, a.therapist_id, t.display_name,
         coalesce(a.contact_name, cu.full_name), a.location_type, z.name, g.reasons, a.updated_at
  from grouped g
  join public.appointments a on a.id = g.id
  join public.services s on s.id = a.service_id
  join public.therapists t on t.id = a.therapist_id
  join public.customers cu on cu.id = a.customer_id
  left join public.dispatch_zones z on z.id = a.dispatch_zone_id
  order by a.starts_at;
end;
$$;

-- The 5b dashboard, plus the number of appointments in conflict.
create or replace function public.staff_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := coalesce((select bs.timezone from public.business_settings bs), 'Africa/Lagos');
  v_today date := (clock_timestamp() at time zone v_tz)::date;
  v_from timestamptz := v_today::timestamp at time zone v_tz;
  v_to timestamptz := (v_today + 1)::timestamp at time zone v_tz;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  return (
    select jsonb_build_object(
      'today', v_today,
      'today_total', count(*) filter (where a.status <> 'cancelled'),
      'today_remaining', count(*) filter (where a.status in ('pending_payment', 'confirmed') and a.starts_at > clock_timestamp()),
      'today_completed', count(*) filter (where a.status = 'completed'),
      'today_no_show', count(*) filter (where a.status = 'no_show'),
      'today_to_collect', count(*) filter (where a.status = 'confirmed' and a.settlement = 'pay_at_venue'),
      'awaiting_outcome', (
        select count(*) from public.appointments x
        where x.status = 'confirmed' and x.ends_at <= clock_timestamp() and x.starts_at >= v_from - interval '7 days'
      ),
      'refunds_flagged', (
        select count(*) from public.payments p where p.needs_refund and p.refund_status <> 'processed'
      ),
      'next_7_days', (
        select count(*) from public.appointments x
        where x.status in ('pending_payment', 'confirmed') and x.starts_at >= v_to and x.starts_at < v_to + interval '7 days'
      ),
      'schedule_conflicts', (select count(distinct c.appointment_id) from private.appointment_conflicts() c)
    )
    from public.appointments a
    where a.starts_at >= v_from and a.starts_at < v_to
  );
end;
$$;

-- =========================================================================
-- 7. Schedule and catalogue tables change only through the functions above
-- =========================================================================
revoke insert, update, delete on
  public.business_hours, public.therapist_schedules, public.therapist_breaks, public.therapist_time_off,
  public.blackout_dates, public.services, public.service_package_items, public.therapist_services,
  public.dispatch_zones
from authenticated;
revoke insert (display_name, title, specialty, bio, photo_url, photo_media_id, is_active, sort_order, is_demo),
       update (display_name, title, specialty, bio, photo_url, photo_media_id, is_active, sort_order, is_demo)
  on public.therapists from authenticated;
revoke insert, update, delete on public.therapists from authenticated;

-- =========================================================================
-- Privileges
-- =========================================================================
revoke execute on function
  private.schedule_block_reason(uuid, timestamptz, timestamptz),
  private.appointment_conflicts(), private.reservation_issues(), private.conflict_snapshot(),
  private.audit_note(text, text, text, text, jsonb),
  private.check_new_conflicts(jsonb, boolean, text, text, text), private.begin_schedule_change(),
  private.hours_version(), private.therapist_week_version(uuid), private.therapist_services_version(uuid),
  private.package_items_version(uuid), private.require_version(text, text), private.parse_time(text),
  private.valid_week_periods(jsonb)
from public;

revoke execute on function
  public.staff_set_business_hours(jsonb, text, text, boolean),
  public.staff_set_therapist_week(uuid, jsonb, jsonb, text, text, boolean),
  public.staff_add_time_off(uuid, timestamptz, timestamptz, text, text, boolean),
  public.staff_remove_time_off(uuid, text),
  public.staff_add_blackout(timestamptz, timestamptz, text, text, boolean),
  public.staff_remove_blackout(uuid, text),
  public.staff_save_service(uuid, timestamptz, jsonb, text, boolean),
  public.staff_set_package_items(uuid, uuid[], text, text),
  public.staff_save_therapist(uuid, timestamptz, jsonb, text, boolean),
  public.staff_set_therapist_services(uuid, uuid[], text, text, boolean),
  public.staff_save_zone(uuid, timestamptz, jsonb, text, boolean),
  public.staff_schedule_overview(),
  public.staff_catalogue(),
  public.staff_schedule_conflicts()
from public, anon;

grant execute on function
  public.staff_set_business_hours(jsonb, text, text, boolean),
  public.staff_set_therapist_week(uuid, jsonb, jsonb, text, text, boolean),
  public.staff_add_time_off(uuid, timestamptz, timestamptz, text, text, boolean),
  public.staff_remove_time_off(uuid, text),
  public.staff_add_blackout(timestamptz, timestamptz, text, text, boolean),
  public.staff_remove_blackout(uuid, text),
  public.staff_save_service(uuid, timestamptz, jsonb, text, boolean),
  public.staff_set_package_items(uuid, uuid[], text, text),
  public.staff_save_therapist(uuid, timestamptz, jsonb, text, boolean),
  public.staff_set_therapist_services(uuid, uuid[], text, text, boolean),
  public.staff_save_zone(uuid, timestamptz, jsonb, text, boolean),
  public.staff_schedule_overview(),
  public.staff_catalogue(),
  public.staff_schedule_conflicts()
to authenticated;
