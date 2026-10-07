-- Phase 5c hardening (approved corrections to 5c).
--
--   1. A guest reservation takes the schedule-rules lock (shared) before its
--      availability decision, like payments, staff bookings and reschedules
--      already do. A reservation and a schedule change can no longer
--      straddle each other: the reservation either sees the change, or is
--      seen by the change's conflict check.
--   2. The payment re-check verifies that an in-home booking's area is still
--      active. If not, no appointment is created and the payment is flagged
--      for refund with reason 'zone_unavailable' (the existing Phase 3 path).
--      Existing appointments are not touched.
--
-- Both functions are otherwise unchanged; the added lines are marked [5c].
-- Lock order stays: schedule-rules lock -> therapist locks -> booking_holds
-- row -> appointments row -> payments rows.

-- ---------------------------------------------------------------------------
-- 1. Guest reservations wait for schedule changes in progress
-- ---------------------------------------------------------------------------
create or replace function public.request_booking_hold(
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
  -- [5c] Shared: reservations do not wait for each other here, only for
  -- schedule and catalogue changes (which take it exclusively).
  perform pg_advisory_xact_lock_shared(private.schedule_rules_lock_key());

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
-- 2. The payment re-check includes the in-home area
-- ---------------------------------------------------------------------------
alter table public.payments
  drop constraint payments_needs_refund_reason_check,
  add constraint payments_needs_refund_reason_check check (
    needs_refund_reason in (
      'slot_retaken', 'hold_released', 'slot_passed', 'amount_mismatch', 'currency_mismatch',
      'duplicate_payment', 'hold_missing', 'schedule_changed', 'service_changed', 'therapist_unavailable',
      'appointment_cancelled',
      -- [5c] The in-home area was deactivated (or removed) before payment completed.
      'zone_unavailable'
    )
  );

-- (replaces the version in 20261007000100; only the [5c] lines differ)
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
    -- [5c] An in-home booking needs its area to still be served.
    elsif v_hold.location_type = 'mobile' and not exists (
      select 1 from public.dispatch_zones z where z.id = v_hold.dispatch_zone_id and z.is_active
    ) then
      v_reason := 'zone_unavailable';
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
          customer_notes, contact_name, contact_phone,
          is_demo -- [demo]
        )
        values (
          v_hold.customer_id, v_hold.service_id, v_hold.therapist_id, v_hold.id,
          v_hold.starts_at, v_hold.ends_at, v_hold.blocked_until, 'confirmed',
          v_hold.location_type, v_hold.dispatch_zone_id, v_hold.service_address,
          v_hold.price_minor, coalesce(v_hold.dispatch_fee_minor, 0), v_hold.currency,
          v_hold.customer_notes, v_hold.contact_name, v_hold.contact_phone,
          v_payment.is_demo -- [demo] booked with simulated money
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

-- ---------------------------------------------------------------------------
-- The conflict warning counts mid-payment in-home guests whose area is no
-- longer served (the payment re-check above now refuses them).
-- ---------------------------------------------------------------------------
create or replace function private.reservation_issues()
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
        -- [5c hardening]
        when h.location_type = 'mobile' and not exists (
          select 1 from public.dispatch_zones z where z.id = h.dispatch_zone_id and z.is_active
        ) then 'zone_inactive'
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
