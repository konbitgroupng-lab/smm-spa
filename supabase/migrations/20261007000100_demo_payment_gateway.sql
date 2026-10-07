-- Phase 3 prototype: a simulated payment provider ("mock") behind the same
-- PaymentGateway interface as Paystack.
--
-- Nothing in the booking or payment domain logic changes. This migration only:
--   * allows 'mock' as a provider name, so demo payments are recorded as such;
--   * adds business_settings.allow_demo_payments, so a database that has not
--     opted in refuses demo payments even if a function is misconfigured;
--   * marks demo payments, and the appointments they create, as demo data;
--   * adds the simulated provider's own ledger (schema mock_provider), which
--     plays the part of Paystack's servers. It is not reachable from the API.
--
-- Switching to Paystack later is configuration (PAYMENT_PROVIDER=paystack plus
-- secrets); this migration can stay in place, unused.

-- ---------------------------------------------------------------------------
-- Provider name and the opt-in switch
-- ---------------------------------------------------------------------------
alter table public.payments
  drop constraint payments_provider_check,
  add constraint payments_provider_check check (provider in ('paystack', 'stripe', 'mock'));

alter table public.payment_events
  drop constraint payment_events_provider_check,
  add constraint payment_events_provider_check check (provider in ('paystack', 'stripe', 'mock'));

alter table public.business_settings
  add column allow_demo_payments boolean not null default false;

-- ---------------------------------------------------------------------------
-- The simulated provider's ledger
-- ---------------------------------------------------------------------------
create schema mock_provider;

create table mock_provider.transactions (
  reference text primary key,
  transaction_id bigint generated always as identity unique,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  email text not null,
  -- Paystack's own words for a transaction's state.
  status text not null default 'abandoned' check (status in ('abandoned', 'pending', 'success', 'failed')),
  paid_at timestamptz,
  channel text,
  gateway_response text not null default 'The transaction was not completed',
  callback_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table mock_provider.transactions enable row level security;
revoke all on schema mock_provider from public;
revoke all on all tables in schema mock_provider from public, anon, authenticated;

create trigger set_updated_at before update on mock_provider.transactions
  for each row execute function private.set_updated_at();

-- A transaction as the provider's verify API would describe it (Paystack field names).
create function private.mock_transaction_json(p_tx mock_provider.transactions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_tx.transaction_id,
    'domain', 'test',
    'status', p_tx.status,
    'reference', p_tx.reference,
    'amount', p_tx.amount_minor,
    'currency', p_tx.currency,
    'paid_at', p_tx.paid_at,
    'channel', p_tx.channel,
    'gateway_response', p_tx.gateway_response,
    'callback_url', p_tx.callback_url,
    'email', p_tx.email
  );
$$;

-- "Create a hosted-checkout transaction" at the simulated provider.
create function public.mock_provider_initialize(
  p_reference text,
  p_amount_minor bigint,
  p_currency text,
  p_email text,
  p_callback_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx mock_provider.transactions;
begin
  if not coalesce((select bs.allow_demo_payments from public.business_settings bs), false) then
    raise exception 'demo_payments_disabled' using errcode = 'P0001';
  end if;
  if exists (select 1 from mock_provider.transactions t where t.reference = p_reference) then
    raise exception 'duplicate_reference' using errcode = 'P0001';
  end if;
  insert into mock_provider.transactions (reference, amount_minor, currency, email, callback_url)
  values (p_reference, p_amount_minor, upper(p_currency), p_email, p_callback_url)
  returning * into v_tx;
  return private.mock_transaction_json(v_tx);
end;
$$;

-- The simulated provider's verify API: null for a reference it never issued.
create function public.mock_provider_get(p_reference text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.mock_transaction_json(t) from mock_provider.transactions t where t.reference = p_reference;
$$;

-- What the guest does on the simulated checkout page.
--   success  card accepted
--   decline  card declined (the guest may try again on the same page)
--   pending  payment started but not yet confirmed (e.g. a bank transfer)
-- A transaction that has succeeded cannot be changed.
create function public.mock_provider_complete(p_reference text, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx mock_provider.transactions;
begin
  if p_outcome not in ('success', 'decline', 'pending') then
    raise exception 'invalid_outcome' using errcode = 'P0001';
  end if;

  select * into v_tx from mock_provider.transactions t where t.reference = p_reference for update;
  if not found then
    raise exception 'transaction_not_found' using errcode = 'P0001';
  end if;
  if v_tx.status = 'success' then
    return private.mock_transaction_json(v_tx);
  end if;

  update mock_provider.transactions
     set status = case p_outcome when 'success' then 'success' when 'decline' then 'failed' else 'pending' end,
         paid_at = case when p_outcome = 'success' then clock_timestamp() else null end,
         channel = case p_outcome when 'pending' then 'bank_transfer' else 'card' end,
         gateway_response = case p_outcome
           when 'success' then 'Approved (demo card)'
           when 'decline' then 'Declined (demo card)'
           else 'Awaiting bank transfer (demo)'
         end
   where reference = p_reference
  returning * into v_tx;
  return private.mock_transaction_json(v_tx);
end;
$$;

-- ---------------------------------------------------------------------------
-- Demo payments are refused unless enabled, and are marked as demo data
-- (replaces the Phase 3 version; only the two marked lines differ)
-- ---------------------------------------------------------------------------
create or replace function public.begin_hold_payment(
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
  -- [demo] A database that has not opted in never accepts simulated payments.
  if p_provider = 'mock' and not v_settings.allow_demo_payments then
    raise exception 'demo_payments_disabled' using errcode = 'P0001';
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
      hold_id, provider, provider_reference, kind, status, amount_minor, booking_total_minor, currency, is_test,
      is_demo -- [demo]
    )
    values (
      v_hold.id, p_provider, 'SMMP-' || upper(replace(gen_random_uuid()::text, '-', '')),
      v_settings.payment_mode, 'initialized', v_amount, v_total, v_service.currency, p_is_test,
      p_provider = 'mock' -- [demo]
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

-- (replaces the version in 20261003000200; only the marked lines differ)
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
-- Privileges: the simulated provider is reachable only by server-side code
-- ---------------------------------------------------------------------------
revoke execute on function private.mock_transaction_json(mock_provider.transactions) from public;

revoke execute on function
  public.mock_provider_initialize(text, bigint, text, text, text),
  public.mock_provider_get(text),
  public.mock_provider_complete(text, text)
from public, anon, authenticated;

grant execute on function
  public.mock_provider_initialize(text, bigint, text, text, text),
  public.mock_provider_get(text),
  public.mock_provider_complete(text, text)
to service_role;
