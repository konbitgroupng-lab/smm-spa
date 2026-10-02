-- Phase 3: payments.
--
-- Invariant: public.record_payment_result() is the only code path that can turn
-- a payment into an appointment. The browser-triggered verify call and the
-- provider webhook both end there, and it only acts on what the provider itself
-- reported. Everything it does happens in one transaction: either the payment is
-- attached to a new appointment, or it is flagged as needing a refund.
--
-- Lock order used by every function that takes more than one lock:
--   therapist advisory lock -> booking_holds row -> payments row

-- ---------------------------------------------------------------------------
-- Schema extensions
-- ---------------------------------------------------------------------------
create type public.refund_status as enum ('none', 'pending', 'processing', 'processed', 'failed', 'needs_attention');

alter table public.business_settings
  add column payment_window_minutes integer not null default 15 check (payment_window_minutes between 1 and 60),
  add column payment_abandon_minutes integer not null default 30 check (payment_abandon_minutes between 5 and 1440);

-- What the guest entered for this booking, and what they agreed to pay.
-- The price snapshot is taken when payment starts and never recalculated.
alter table public.booking_holds
  add column contact_name text,
  add column contact_phone text,
  add column service_address text,
  add column customer_notes text,
  add column price_minor bigint check (price_minor is null or price_minor >= 0),
  add column dispatch_fee_minor bigint check (dispatch_fee_minor is null or dispatch_fee_minor >= 0),
  add column currency char(3),
  add column payment_extended_at timestamptz;

alter table public.appointments
  add column contact_name text,
  add column contact_phone text;

alter table public.payments
  add column booking_total_minor bigint check (booking_total_minor is null or booking_total_minor >= 0),
  add column checkout_url text,
  -- What the provider reported.
  add column paid_minor bigint check (paid_minor is null or paid_minor >= 0),
  add column paid_currency char(3),
  add column provider_transaction_id text,
  add column channel text,
  add column verified_at timestamptz,
  -- Set when money was received but no appointment could be created.
  add column needs_refund boolean not null default false,
  add column needs_refund_reason text check (
    needs_refund_reason in (
      'slot_retaken', 'hold_released', 'slot_passed', 'amount_mismatch', 'currency_mismatch',
      'duplicate_payment', 'hold_missing'
    )
  ),
  -- Refund lifecycle, driven by provider events. Refunds are not initiated here.
  add column refund_status public.refund_status not null default 'none',
  add column refund_reference text,
  add column refund_reason text,
  add column refund_requested_at timestamptz,
  add column refund_processed_at timestamptz,
  add column refund_error text,
  add constraint payments_needs_refund_reason check (needs_refund = (needs_refund_reason is not null) or refund_status = 'processed');

-- A refund can never exceed what was actually received (which may differ from
-- the expected amount when the provider reports a mismatch).
alter table public.payments drop constraint payments_check;
alter table public.payments
  add constraint payments_refund_within_paid check (refunded_minor <= coalesce(paid_minor, amount_minor)),
  add column refundable_minor bigint generated always as (
    case when paid_minor is null then 0 else greatest(paid_minor - refunded_minor, 0) end
  ) stored;

-- One open payment per hold.
create unique index payments_one_open_per_hold on public.payments (hold_id)
  where status in ('initialized', 'pending');
create index payments_needs_refund_idx on public.payments (created_at) where needs_refund;

alter table public.payment_events
  add column processing_error text;

-- ---------------------------------------------------------------------------
-- Guest contact details stay with the booking (replaces the Phase 2 version)
-- ---------------------------------------------------------------------------
-- A guest whose email is already on file is linked to that customer and the
-- customer's master record is left alone. The name and phone they typed are
-- kept on the hold and copied to the appointment.
create or replace function public.attach_customer_to_hold(
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

  update public.booking_holds
     set customer_id = v_customer_id, contact_name = v_name, contact_phone = v_phone
   where id = v_hold.id
  returning * into v_hold;
  return v_hold;
end;
$$;

-- ---------------------------------------------------------------------------
-- Starting a payment
-- ---------------------------------------------------------------------------
-- Creates the payment record for a live hold and returns what the provider
-- needs. The amount is computed here from the catalogue and business settings;
-- nothing supplied by the browser influences it.
-- Calling it again while a payment is open returns that same payment.
-- The hold is extended once, to payment_window_minutes from the first call.
create function public.begin_hold_payment(
  p_hold_token uuid,
  p_provider text,
  p_is_test boolean,
  p_service_address text default null,
  p_customer_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.business_settings;
  v_hold public.booking_holds;
  v_service public.services;
  v_payment public.payments;
  v_email text;
  v_fee bigint := 0;
  v_total bigint;
  v_amount bigint;
  v_address text := nullif(trim(coalesce(p_service_address, '')), '');
  v_notes text := nullif(trim(coalesce(p_customer_notes, '')), '');
  v_is_new boolean := false;
begin
  select * into v_settings from public.business_settings;
  if not found or not v_settings.online_payment_enabled then
    raise exception 'payments_disabled' using errcode = 'P0001';
  end if;

  select * into v_hold
  from public.booking_holds h
  where h.hold_token = p_hold_token and h.status = 'active' and h.expires_at > clock_timestamp()
  for update;
  if not found then
    raise exception 'hold_expired' using errcode = 'P0001';
  end if;
  if v_hold.customer_id is null then
    raise exception 'customer_required' using errcode = 'P0001';
  end if;

  select c.email into v_email from public.customers c where c.id = v_hold.customer_id;

  select * into v_payment
  from public.payments p
  where p.hold_id = v_hold.id and p.status in ('initialized', 'pending');

  if not found then
    if v_hold.location_type = 'mobile' and coalesce(v_address, v_hold.service_address) is null then
      raise exception 'address_required' using errcode = 'P0001';
    end if;

    select * into v_service from public.services s where s.id = v_hold.service_id;
    if v_hold.location_type = 'mobile' then
      select coalesce(z.fee_minor, 0) into v_fee from public.dispatch_zones z where z.id = v_hold.dispatch_zone_id;
      v_fee := coalesce(v_fee, 0);
    end if;
    v_total := v_service.price_minor + v_fee;
    v_amount := case v_settings.payment_mode
      when 'deposit' then (v_total * v_settings.deposit_percent + 99) / 100 -- rounded up
      else v_total
    end;
    if v_amount <= 0 then
      raise exception 'nothing_to_pay' using errcode = 'P0001';
    end if;

    update public.booking_holds
       set service_address = coalesce(v_address, service_address),
           customer_notes = coalesce(v_notes, customer_notes),
           price_minor = v_service.price_minor,
           dispatch_fee_minor = v_fee,
           currency = v_service.currency,
           -- Extended once only: repeated calls must not keep a slot blocked.
           expires_at = case when payment_extended_at is null
             then greatest(expires_at, clock_timestamp() + make_interval(mins => v_settings.payment_window_minutes))
             else expires_at end,
           payment_extended_at = coalesce(payment_extended_at, clock_timestamp())
     where id = v_hold.id
    returning * into v_hold;

    insert into public.payments (
      hold_id, provider, provider_reference, kind, status, amount_minor, booking_total_minor, currency, is_test
    )
    values (
      v_hold.id, p_provider, 'SMMP-' || upper(replace(gen_random_uuid()::text, '-', '')),
      v_settings.payment_mode, 'initialized', v_amount, v_total, v_service.currency, p_is_test
    )
    returning * into v_payment;
    v_is_new := true;
  end if;

  return jsonb_build_object(
    'is_new', v_is_new,
    'reference', v_payment.provider_reference,
    'amount_minor', v_payment.amount_minor,
    'booking_total_minor', v_payment.booking_total_minor,
    'currency', v_payment.currency,
    'kind', v_payment.kind,
    'email', v_email,
    'checkout_url', v_payment.checkout_url,
    'hold_expires_at', v_hold.expires_at
  );
end;
$$;

-- Stores the provider's checkout address once the transaction exists there.
create function public.set_payment_checkout(p_provider text, p_reference text, p_checkout_url text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payments set checkout_url = p_checkout_url
   where provider = p_provider and provider_reference = p_reference and status = 'initialized';
$$;

-- The provider refused to create the transaction: close the record so the guest can retry.
create function public.mark_payment_init_failed(p_provider text, p_reference text, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payments set status = 'failed', failure_reason = left(p_reason, 500)
   where provider = p_provider and provider_reference = p_reference
     and status = 'initialized' and checkout_url is null;
$$;

-- ---------------------------------------------------------------------------
-- What a guest holding the payment reference may learn
-- ---------------------------------------------------------------------------
create function private.payment_outcome(p_payment public.payments)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', case
      when p_payment.status in ('succeeded', 'partially_refunded', 'refunded') and p_payment.appointment_id is not null then 'confirmed'
      when p_payment.status in ('succeeded', 'partially_refunded', 'refunded') then 'refund_required'
      when p_payment.status in ('failed', 'abandoned') then 'failed'
      else 'pending'
    end,
    'payment_status', p_payment.status,
    'reason', p_payment.needs_refund_reason,
    'appointment', (
      select jsonb_build_object('reference', a.reference, 'starts_at', a.starts_at, 'ends_at', a.ends_at)
      from public.appointments a where a.id = p_payment.appointment_id
    )
  );
$$;

-- Current outcome without changing anything; null when the reference is unknown.
create function public.get_payment_outcome(p_provider text, p_reference text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.payment_outcome(p)
  from public.payments p
  where p.provider = p_provider and p.provider_reference = p_reference;
$$;

-- ---------------------------------------------------------------------------
-- The payment state machine
-- ---------------------------------------------------------------------------
-- p_status is the provider's verdict, normalised to: success | failed | pending.
-- Safe to call any number of times, from any number of connections, for the
-- same reference: the first successful call does the work, later calls return
-- the same outcome.
create function public.record_payment_result(
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
  v_hold_id uuid;
  v_therapist_id uuid;
  v_appointment_id uuid;
  v_reason text;
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
    -- The slot is checked here, at the moment of creation, under the therapist
    -- lock: the Phase 1 exclusion constraint and guard trigger refuse the
    -- insert if another appointment or another guest's live hold has the time.
    -- An expired or released hold of the payer's own does not block it.
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

  if v_appointment_id is not null then
    update public.payments set appointment_id = v_appointment_id where id = v_payment.id returning * into v_payment;
  else
    update public.payments
       set needs_refund = true, needs_refund_reason = v_reason
     where id = v_payment.id
    returning * into v_payment;
  end if;

  return private.payment_outcome(v_payment);
end;
$$;

-- ---------------------------------------------------------------------------
-- Refund lifecycle (recorded from provider events; never initiated here)
-- ---------------------------------------------------------------------------
create function public.record_refund_event(
  p_provider text,
  p_transaction_reference text,
  p_refund_status text,
  p_refund_reference text default null,
  p_amount_minor bigint default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_status public.refund_status;
  v_refunded bigint;
begin
  v_status := case p_refund_status
    when 'pending' then 'pending'
    when 'processing' then 'processing'
    when 'processed' then 'processed'
    when 'failed' then 'failed'
    when 'needs-attention' then 'needs_attention'
    else null
  end;
  if v_status is null then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  select * into v_payment
  from public.payments p where p.provider = p_provider and p.provider_reference = p_transaction_reference
  for update;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0001';
  end if;
  if v_payment.paid_minor is null then
    raise exception 'payment_not_paid' using errcode = 'P0001';
  end if;

  if v_status = 'processed' then
    -- The same refund reported twice must not be counted twice.
    if v_payment.refund_status = 'processed' and v_payment.refund_reference is not distinct from p_refund_reference then
      return private.payment_outcome(v_payment);
    end if;
    v_refunded := least(v_payment.paid_minor, v_payment.refunded_minor + coalesce(p_amount_minor, v_payment.refundable_minor));
    update public.payments
       set refund_status = 'processed',
           refund_reference = coalesce(p_refund_reference, refund_reference),
           refund_reason = coalesce(p_reason, refund_reason),
           refund_requested_at = coalesce(refund_requested_at, clock_timestamp()),
           refund_processed_at = clock_timestamp(),
           refund_error = null,
           refunded_minor = v_refunded,
           status = case when v_refunded >= paid_minor then 'refunded' else 'partially_refunded' end::public.payment_status,
           needs_refund = case when v_refunded >= paid_minor then false else needs_refund end
     where id = v_payment.id
    returning * into v_payment;
  else
    update public.payments
       set refund_status = v_status,
           refund_reference = coalesce(p_refund_reference, refund_reference),
           refund_reason = case when v_status in ('pending', 'processing') then coalesce(p_reason, refund_reason) else refund_reason end,
           refund_requested_at = coalesce(refund_requested_at, clock_timestamp()),
           refund_error = case when v_status in ('failed', 'needs_attention') then left(coalesce(p_reason, 'refund ' || p_refund_status), 500) else null end
     where id = v_payment.id
    returning * into v_payment;
  end if;

  return private.payment_outcome(v_payment);
end;
$$;

-- ---------------------------------------------------------------------------
-- Webhook delivery log (idempotency)
-- ---------------------------------------------------------------------------
-- Records a delivery once. Returns whether an earlier delivery of the same
-- event was already fully processed; an unfinished one is processed again.
create function public.log_payment_event(p_provider text, p_event_id text, p_event_type text, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_processed_at timestamptz;
begin
  insert into public.payment_events (provider, event_id, event_type, payload)
  values (p_provider, p_event_id, p_event_type, p_payload)
  on conflict (provider, event_id) do nothing;

  select e.processed_at into v_processed_at
  from public.payment_events e where e.provider = p_provider and e.event_id = p_event_id;
  return v_processed_at is not null;
end;
$$;

create function public.finish_payment_event(p_provider text, p_event_id text, p_reference text default null, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_events e
     set processed_at = case when p_error is null then coalesce(e.processed_at, clock_timestamp()) else e.processed_at end,
         processing_error = left(p_error, 500),
         payment_id = coalesce(e.payment_id, (
           select p.id from public.payments p where p.provider = p_provider and p.provider_reference = p_reference
         ))
   where e.provider = p_provider and e.event_id = p_event_id;
$$;

-- ---------------------------------------------------------------------------
-- Maintenance (replaces the Phase 2 version; same one-minute cron job)
-- ---------------------------------------------------------------------------
-- Sweeps expired holds, closes payments that never completed, prunes counters.
-- An abandoned payment can still succeed later if the provider confirms it.
create or replace function public.run_booking_maintenance()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released integer;
begin
  with expired as (
    select h.id from public.booking_holds h
    where h.status = 'active' and h.expires_at <= clock_timestamp()
    order by h.id
    for update skip locked
  )
  update public.booking_holds h set status = 'expired' from expired where h.id = expired.id;
  get diagnostics v_released = row_count;

  update public.payments p
     set status = 'abandoned'
   where p.status in ('initialized', 'pending')
     and p.created_at <= clock_timestamp() - make_interval(
       mins => coalesce((select bs.payment_abandon_minutes from public.business_settings bs), 30));

  delete from private.rate_limit_hits where window_start < clock_timestamp() - interval '1 day';
  return v_released;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: payment functions are for server-side code only
-- ---------------------------------------------------------------------------
revoke execute on function private.payment_outcome(public.payments) from public;

revoke execute on function
  public.begin_hold_payment(uuid, text, boolean, text, text),
  public.set_payment_checkout(text, text, text),
  public.mark_payment_init_failed(text, text, text),
  public.get_payment_outcome(text, text),
  public.record_payment_result(text, text, text, bigint, text, timestamptz, text, text, text),
  public.record_refund_event(text, text, text, text, bigint, text),
  public.log_payment_event(text, text, text, jsonb),
  public.finish_payment_event(text, text, text, text)
from public, anon, authenticated;

grant execute on function
  public.begin_hold_payment(uuid, text, boolean, text, text),
  public.set_payment_checkout(text, text, text),
  public.mark_payment_init_failed(text, text, text),
  public.get_payment_outcome(text, text),
  public.record_payment_result(text, text, text, bigint, text, timestamptz, text, text, text),
  public.record_refund_event(text, text, text, text, bigint, text),
  public.log_payment_event(text, text, text, jsonb),
  public.finish_payment_event(text, text, text, text)
to service_role;
