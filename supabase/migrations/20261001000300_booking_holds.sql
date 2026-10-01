-- Phase 1: booking concurrency foundation.
--
-- Two layers stop double booking, whichever code path writes the row:
--   1. Exclusion constraints (core schema): no two active holds overlap for a
--      therapist, and no two live appointments overlap for a therapist.
--   2. Guard triggers (below): a hold may not overlap a live appointment and an
--      appointment may not overlap someone else's unexpired hold. Both take a
--      per-therapist advisory lock so concurrent transactions are serialised.
--
-- Checking the slot against business hours, shifts, breaks, time off and
-- blackout dates is Phase 2; until then only service_role may create holds.

create function private.lock_therapist(p_therapist_id uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended(p_therapist_id::text, 0));
$$;

create function private.guard_booking_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' then
    return new;
  end if;

  perform private.lock_therapist(new.therapist_id);

  -- Holds past their expiry no longer block the slot, even if no job has swept them yet.
  update public.booking_holds h
     set status = 'expired'
   where h.therapist_id = new.therapist_id
     and h.status = 'active'
     and h.expires_at <= clock_timestamp()
     and h.id <> new.id;

  if exists (
    select 1 from public.appointments a
    where a.therapist_id = new.therapist_id
      and a.status in ('pending_payment', 'confirmed', 'completed')
      and tstzrange(a.starts_at, a.blocked_until) && tstzrange(new.starts_at, new.blocked_until)
  ) then
    raise exception 'slot_unavailable' using errcode = '23P01';
  end if;

  return new;
end;
$$;

create trigger guard_booking_hold
  before insert or update of therapist_id, starts_at, blocked_until, status on public.booking_holds
  for each row execute function private.guard_booking_hold();

create function private.guard_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status not in ('pending_payment', 'confirmed', 'completed') then
    return new;
  end if;

  perform private.lock_therapist(new.therapist_id);

  if exists (
    select 1 from public.booking_holds h
    where h.therapist_id = new.therapist_id
      and h.status = 'active'
      and h.expires_at > clock_timestamp()
      and h.id is distinct from new.hold_id -- the appointment's own hold does not block it
      and tstzrange(h.starts_at, h.blocked_until) && tstzrange(new.starts_at, new.blocked_until)
  ) then
    raise exception 'slot_unavailable' using errcode = '23P01';
  end if;

  return new;
end;
$$;

create trigger guard_appointment
  before insert or update of therapist_id, starts_at, blocked_until, status on public.appointments
  for each row execute function private.guard_appointment();

-- Reserve a slot for business_settings.hold_minutes (10 by default).
-- Raises slot_unavailable (SQLSTATE 23P01) when the slot is already taken.
create function public.create_booking_hold(
  p_service_id uuid,
  p_therapist_id uuid,
  p_starts_at timestamptz,
  p_location_type public.location_type default 'sanctuary',
  p_dispatch_zone_id uuid default null
)
returns public.booking_holds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service public.services;
  v_hold_minutes integer;
  v_ends_at timestamptz;
  v_hold public.booking_holds;
begin
  select * into v_service from public.services s where s.id = p_service_id and s.is_active;
  if not found then
    raise exception 'service_unavailable' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.therapists t
    join public.therapist_services ts on ts.therapist_id = t.id
    where t.id = p_therapist_id and t.is_active and ts.service_id = p_service_id
  ) then
    raise exception 'therapist_unavailable' using errcode = 'P0001';
  end if;

  if p_starts_at <= clock_timestamp() then
    raise exception 'start_in_past' using errcode = 'P0001';
  end if;

  select coalesce((select bs.hold_minutes from public.business_settings bs), 10) into v_hold_minutes;
  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_minutes);

  begin
    insert into public.booking_holds (
      service_id, therapist_id, starts_at, ends_at, blocked_until, expires_at,
      location_type, dispatch_zone_id
    )
    values (
      p_service_id, p_therapist_id, p_starts_at, v_ends_at,
      v_ends_at + make_interval(mins => v_service.buffer_minutes),
      clock_timestamp() + make_interval(mins => v_hold_minutes),
      p_location_type, p_dispatch_zone_id
    )
    returning * into v_hold;
  exception
    when exclusion_violation then
      raise exception 'slot_unavailable' using errcode = '23P01';
  end;

  return v_hold;
end;
$$;

-- Sweep for abandoned checkouts. Correctness does not depend on it (expired
-- holds already stop blocking); it keeps the table tidy. Returns the number released.
create function public.release_expired_booking_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.booking_holds
     set status = 'expired'
   where status = 'active' and expires_at <= clock_timestamp();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function
  private.lock_therapist(uuid), private.guard_booking_hold(), private.guard_appointment()
from public;

revoke execute on function
  public.create_booking_hold(uuid, uuid, timestamptz, public.location_type, uuid),
  public.release_expired_booking_holds()
from public, anon, authenticated;

grant execute on function
  public.create_booking_hold(uuid, uuid, timestamptz, public.location_type, uuid),
  public.release_expired_booking_holds()
to service_role;
