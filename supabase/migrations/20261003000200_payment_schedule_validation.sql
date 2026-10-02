-- Phase 3 correction: a paid hold is checked against the *current* scheduling
-- rules before it becomes an appointment.
--
-- record_payment_result() now re-runs the Phase 2 rule set (opening hours,
-- shifts, breaks, time off, blackout dates, minimum notice, booking window,
-- grid, other reservations) and checks that the service and therapist are
-- still as they were when the slot was held.
--
-- No race between that check and the insert: every statement that changes a
-- scheduling rule takes the "schedule rules" advisory lock exclusively, and
-- record_payment_result() holds it in shared mode from before the check until
-- its transaction ends. A rule change therefore either commits before the
-- check (and is seen by it) or waits until the appointment exists.
--
-- Lock order: schedule-rules lock -> therapist lock -> booking_holds row -> payments row.

-- ---------------------------------------------------------------------------
-- Structured refund reasons
-- ---------------------------------------------------------------------------
alter table public.payments
  add column needs_refund_detail text,
  drop constraint payments_needs_refund_reason_check,
  add constraint payments_needs_refund_reason_check check (
    needs_refund_reason in (
      'slot_retaken', 'hold_released', 'slot_passed', 'amount_mismatch', 'currency_mismatch',
      'duplicate_payment', 'hold_missing',
      -- A scheduling rule no longer allows the slot; needs_refund_detail names the rule.
      'schedule_changed',
      -- The service was withdrawn or its duration/buffer changed after the slot was held.
      'service_changed',
      -- The therapist was withdrawn or no longer offers the service.
      'therapist_unavailable'
    )
  );

-- ---------------------------------------------------------------------------
-- The schedule-rules lock
-- ---------------------------------------------------------------------------
create function private.schedule_rules_lock_key()
returns bigint
language sql
immutable
set search_path = ''
as $$
  select hashtextextended('smm.schedule_rules', 0);
$$;

create function private.lock_schedule_rules_for_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(private.schedule_rules_lock_key());
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'business_settings', 'business_hours', 'blackout_dates',
    'therapist_schedules', 'therapist_breaks', 'therapist_time_off',
    'services', 'therapists', 'therapist_services'
  ]
  loop
    execute format(
      'create trigger lock_schedule_rules before insert or update or delete on public.%I
         for each statement execute function private.lock_schedule_rules_for_change()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- The rule set, with two additions for payment time
-- ---------------------------------------------------------------------------
-- p_as_of           the moment the booking counts as "made", for the minimum
--                   notice and booking window rules.
-- p_ignore_hold_id  the payer's own hold, which must not block its own slot.
-- The Phase 2 behaviour is this function with p_as_of = now and no ignored hold.
create function private.slot_block_reason(
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
      and h.id is distinct from p_ignore_hold_id
      and tstzrange(h.starts_at, h.blocked_until) && tstzrange(p_starts_at, p_blocked_until)
  ) then
    return 'slot_taken';
  end if;

  return null;
end;
$$;

-- One rule set: the Phase 2 entry point now delegates to the function above.
create or replace function private.slot_block_reason(
  p_therapist_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_blocked_until timestamptz
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.slot_block_reason(p_therapist_id, p_starts_at, p_ends_at, p_blocked_until, clock_timestamp(), null);
$$;

revoke execute on function
  private.slot_block_reason(uuid, timestamptz, timestamptz, timestamptz, timestamptz, uuid),
  private.lock_schedule_rules_for_change(),
  private.schedule_rules_lock_key()
from public;

-- ---------------------------------------------------------------------------
-- The payment state machine (replaces the version in the previous migration)
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_result(
  p_provider text,
  p_reference text,
  p_status text,
  p_paid_minor bigint default null,
  p_currency text default null,
  p_paid_at timestamptz default null,
  p_transaction_id text default null,
  p_channel text default null,
  p_failure_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_hold public.booking_holds;
  v_service public.services;
  v_hold_id uuid;
  v_therapist_id uuid;
  v_appointment_id uuid;
  v_hold_live boolean;
  v_reason text;
  v_detail text;
  v_rule text;
begin
  if p_status not in ('success', 'failed', 'pending') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  -- Locks, in the documented order. The hold id and therapist are read first
  -- without locking, only to know which locks to take.
  select p.hold_id into v_hold_id
  from public.payments p where p.provider = p_provider and p.provider_reference = p_reference;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0001';
  end if;

  if p_status = 'success' and v_hold_id is not null then
    select h.therapist_id into v_therapist_id from public.booking_holds h where h.id = v_hold_id;
    if v_therapist_id is not null then
      -- Shared: payments do not wait for each other here, only for rule changes.
      perform pg_advisory_xact_lock_shared(private.schedule_rules_lock_key());
      perform private.lock_therapist(v_therapist_id);
      select * into v_hold from public.booking_holds h where h.id = v_hold_id for update;
    end if;
  end if;

  select * into v_payment
  from public.payments p where p.provider = p_provider and p.provider_reference = p_reference
  for update;

  -- Money already accounted for: nothing more to do, whoever asks.
  if v_payment.status in ('succeeded', 'partially_refunded', 'refunded') then
    return private.payment_outcome(v_payment);
  end if;

  if p_status = 'pending' then
    if v_payment.status = 'initialized' then
      update public.payments set status = 'pending' where id = v_payment.id returning * into v_payment;
    end if;
    return private.payment_outcome(v_payment);
  end if;

  if p_status = 'failed' then
    update public.payments
       set status = 'failed', failure_reason = left(coalesce(p_failure_reason, 'declined'), 500), verified_at = clock_timestamp()
     where id = v_payment.id
    returning * into v_payment;
    return private.payment_outcome(v_payment);
  end if;

  -- From here on the provider has confirmed that money was received.
  if p_paid_minor is null or p_currency is null then
    raise exception 'incomplete_result' using errcode = 'P0001';
  end if;

  update public.payments
     set status = 'succeeded',
         paid_minor = p_paid_minor,
         paid_currency = upper(p_currency),
         paid_at = coalesce(p_paid_at, clock_timestamp()),
         provider_transaction_id = p_transaction_id,
         channel = p_channel,
         failure_reason = null,
         verified_at = clock_timestamp()
   where id = v_payment.id
  returning * into v_payment;

  if upper(p_currency) <> v_payment.currency then
    v_reason := 'currency_mismatch';
  elsif p_paid_minor <> v_payment.amount_minor then
    v_reason := 'amount_mismatch';
  elsif v_hold.id is null or v_hold.customer_id is null then
    v_reason := 'hold_missing';
  elsif v_hold.status = 'converted' then
    v_reason := 'duplicate_payment';
  elsif v_hold.starts_at <= clock_timestamp() then
    v_reason := 'slot_passed';
  else
    v_hold_live := v_hold.status = 'active' and v_hold.expires_at > clock_timestamp();
    select * into v_service from public.services s where s.id = v_hold.service_id;

    if not v_service.is_active then
      v_reason := 'service_changed';
      v_detail := 'inactive';
    elsif v_hold.ends_at <> v_hold.starts_at + make_interval(mins => v_service.duration_minutes)
       or v_hold.blocked_until <> v_hold.ends_at + make_interval(mins => v_service.buffer_minutes) then
      v_reason := 'service_changed';
      v_detail := 'duration';
    elsif not exists (
      select 1
      from public.therapists t
      join public.therapist_services ts on ts.therapist_id = t.id
      where t.id = v_hold.therapist_id and t.is_active and ts.service_id = v_hold.service_id
    ) then
      v_reason := 'therapist_unavailable';
    else
      -- The current rule set. A live hold was a booking made when the hold was
      -- created, so notice and booking window are measured from then; a hold
      -- that has lapsed is a new booking made now.
      v_rule := private.slot_block_reason(
        v_hold.therapist_id, v_hold.starts_at, v_hold.ends_at, v_hold.blocked_until,
        case when v_hold_live then v_hold.created_at else clock_timestamp() end,
        v_hold.id
      );
      if v_rule = 'slot_taken' then
        v_reason := case when v_hold.status = 'released' then 'hold_released' else 'slot_retaken' end;
      elsif v_rule is not null then
        v_reason := 'schedule_changed';
        v_detail := v_rule;
      end if;
    end if;

    if v_reason is null then
      -- Final safeguard: the Phase 1 exclusion constraint and guard trigger
      -- refuse the insert if any other live reservation has the time.
      begin
        insert into public.appointments (
          customer_id, service_id, therapist_id, hold_id, starts_at, ends_at, blocked_until, status,
          location_type, dispatch_zone_id, service_address, price_minor, dispatch_fee_minor, currency,
          customer_notes, contact_name, contact_phone
        )
        values (
          v_hold.customer_id, v_hold.service_id, v_hold.therapist_id, v_hold.id,
          v_hold.starts_at, v_hold.ends_at, v_hold.blocked_until, 'confirmed',
          v_hold.location_type, v_hold.dispatch_zone_id, v_hold.service_address,
          v_hold.price_minor, coalesce(v_hold.dispatch_fee_minor, 0), v_hold.currency,
          v_hold.customer_notes, v_hold.contact_name, v_hold.contact_phone
        )
        returning id into v_appointment_id;

        update public.booking_holds set status = 'converted' where id = v_hold.id;
      exception
        when exclusion_violation then
          v_appointment_id := null;
          v_reason := case when v_hold.status = 'released' then 'hold_released' else 'slot_retaken' end;
      end;
    end if;
  end if;

  if v_appointment_id is not null then
    update public.payments set appointment_id = v_appointment_id where id = v_payment.id returning * into v_payment;
  else
    update public.payments
       set needs_refund = true, needs_refund_reason = v_reason, needs_refund_detail = v_detail
     where id = v_payment.id
    returning * into v_payment;
  end if;

  return private.payment_outcome(v_payment);
end;
$$;
