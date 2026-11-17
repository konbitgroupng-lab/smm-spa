-- Guest bookings paid by direct bank transfer (part 2 of 2).
--
-- A guest who chooses "Pay by bank transfer" turns their live reservation
-- into a booking that is awaiting payment (status pending_payment, settlement
-- bank_transfer). Like every pending booking it blocks its time at once. The
-- guest is shown the spa's account, the amount and the booking reference; the
-- owner or an admin confirms the transfer in the staff app. A booking whose
-- transfer is not confirmed by its deadline is cancelled automatically by the
-- maintenance job and its time is free again.
--
-- Rules that hold everywhere:
--   * No provider payment is ever attached to a transfer booking (the Phase
--     5b ledger guard already refuses any booking not settled online).
--   * The amount is worked out exactly as for online payment (full or
--     deposit, plus the in-home travel fee), by the server.
--   * The guest's page is reached with an unguessable token, never with the
--     booking reference alone.
--   * Only the owner changes the bank details; every change is audited.
--   * A guest can have only a few unpaid transfer bookings at once.

-- =========================================================================
-- 1. Settings and booking columns
-- =========================================================================
alter table public.business_settings
  add column transfer_enabled boolean not null default false,
  add column bank_name text check (bank_name is null or length(bank_name) between 2 and 80),
  add column bank_account_number text check (bank_account_number is null or bank_account_number ~ '^[0-9]{6,20}$'),
  add column bank_account_name text check (bank_account_name is null or length(bank_account_name) between 2 and 120),
  -- How long a guest's time stays reserved while the transfer is checked.
  add column transfer_hold_minutes integer not null default 120 check (transfer_hold_minutes between 30 and 1440),
  -- Unpaid transfer bookings one guest may have at the same time.
  add column transfer_max_unpaid integer not null default 2 check (transfer_max_unpaid between 1 and 10),
  add constraint business_settings_transfer_account check (
    not transfer_enabled or (bank_name is not null and bank_account_number is not null and bank_account_name is not null)
  );

alter table public.appointments
  add column transfer_token uuid unique,
  add column transfer_amount_minor bigint check (transfer_amount_minor is null or transfer_amount_minor > 0),
  add column transfer_due_at timestamptz,
  add column transfer_received_at timestamptz,
  add column transfer_received_by uuid references public.profiles (id) on delete set null,
  add constraint appointments_transfer_fields check (
    (settlement = 'bank_transfer') = (transfer_token is not null and transfer_amount_minor is not null and transfer_due_at is not null)
  );

-- Online bookings are settled by online payment or by bank transfer; staff
-- (phone and WhatsApp) bookings by neither.
alter table public.appointments
  drop constraint appointments_source_settlement,
  add constraint appointments_source_settlement check (
    (source = 'online') = (settlement in ('online_payment', 'bank_transfer'))
  );

-- The guest's page token is a credential: the activity log records only that it changed.
insert into private.audit_personal_columns (entity_type, column_name) values ('appointments', 'transfer_token');

-- =========================================================================
-- 2. The guest chooses to pay by transfer (server-side code only)
-- =========================================================================
create function public.request_transfer_booking(
  p_hold_token uuid,
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
  v_therapist uuid;
  v_fee bigint := 0;
  v_total bigint;
  v_amount bigint;
  v_due timestamptz;
  v_rule text;
  v_address text := nullif(trim(coalesce(p_service_address, '')), '');
  v_notes text := nullif(trim(coalesce(p_customer_notes, '')), '');
  v_appt public.appointments;
begin
  select * into v_settings from public.business_settings;
  if not found or not v_settings.transfer_enabled then
    raise exception 'transfers_disabled' using errcode = 'P0001';
  end if;

  -- Locks, in the documented order: schedule rules (shared) -> therapist -> hold.
  select h.therapist_id into v_therapist from public.booking_holds h where h.hold_token = p_hold_token;
  if not found then
    raise exception 'hold_expired' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock_shared(private.schedule_rules_lock_key());
  perform private.lock_therapist(v_therapist);
  select * into v_hold from public.booking_holds h
   where h.hold_token = p_hold_token and h.status = 'active' and h.expires_at > clock_timestamp()
   for update;
  if not found then
    raise exception 'hold_expired' using errcode = 'P0001';
  end if;
  if v_hold.customer_id is null then
    raise exception 'customer_required' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payments p where p.hold_id = v_hold.id and p.status in ('succeeded', 'partially_refunded', 'refunded')) then
    raise exception 'already_paid' using errcode = 'P0001';
  end if;
  if v_hold.location_type = 'mobile' and coalesce(v_address, v_hold.service_address) is null then
    raise exception 'address_required' using errcode = 'P0001';
  end if;

  -- The guest must have time to transfer, and the spa to check, before the appointment.
  v_due := least(clock_timestamp() + make_interval(mins => v_settings.transfer_hold_minutes),
                 v_hold.starts_at - interval '15 minutes');
  if v_due < clock_timestamp() + interval '20 minutes' then
    raise exception 'transfer_too_late' using errcode = 'P0001';
  end if;

  if (select count(*) from public.appointments a
       where a.customer_id = v_hold.customer_id and a.settlement = 'bank_transfer' and a.status = 'pending_payment')
     >= v_settings.transfer_max_unpaid then
    raise exception 'transfer_limit' using errcode = 'P0001';
  end if;

  -- The same checks as when an online payment arrives for a live reservation.
  select * into v_service from public.services s where s.id = v_hold.service_id;
  if not v_service.is_active
     or v_hold.ends_at <> v_hold.starts_at + make_interval(mins => v_service.duration_minutes)
     or v_hold.blocked_until <> v_hold.ends_at + make_interval(mins => v_service.buffer_minutes)
     or not exists (
       select 1 from public.therapists t join public.therapist_services ts on ts.therapist_id = t.id
        where t.id = v_hold.therapist_id and t.is_active and ts.service_id = v_hold.service_id)
     or (v_hold.location_type = 'mobile' and not exists (
       select 1 from public.dispatch_zones z where z.id = v_hold.dispatch_zone_id and z.is_active)) then
    raise exception 'schedule_changed' using errcode = 'P0001';
  end if;
  v_rule := private.slot_block_reason(v_hold.therapist_id, v_hold.starts_at, v_hold.ends_at, v_hold.blocked_until, v_hold.created_at, v_hold.id);
  if v_rule = 'slot_taken' then
    raise exception 'slot_unavailable' using errcode = '23P01', detail = 'slot_taken';
  elsif v_rule is not null then
    raise exception 'schedule_changed' using errcode = 'P0001', detail = v_rule;
  end if;

  -- The amount, exactly as for online payment.
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

  begin
    insert into public.appointments (
      customer_id, service_id, therapist_id, hold_id, starts_at, ends_at, blocked_until, status,
      location_type, dispatch_zone_id, service_address, price_minor, dispatch_fee_minor, currency,
      customer_notes, contact_name, contact_phone, source, settlement,
      transfer_token, transfer_amount_minor, transfer_due_at
    )
    values (
      v_hold.customer_id, v_hold.service_id, v_hold.therapist_id, v_hold.id,
      v_hold.starts_at, v_hold.ends_at, v_hold.blocked_until, 'pending_payment',
      v_hold.location_type, v_hold.dispatch_zone_id, coalesce(v_address, v_hold.service_address),
      v_service.price_minor, v_fee, v_service.currency,
      coalesce(v_notes, v_hold.customer_notes), v_hold.contact_name, v_hold.contact_phone, 'online', 'bank_transfer',
      gen_random_uuid(), v_amount, v_due
    )
    returning * into v_appt;
  exception
    when exclusion_violation then
      raise exception 'slot_unavailable' using errcode = '23P01', detail = 'slot_taken';
  end;
  update public.booking_holds set status = 'converted' where id = v_hold.id;

  return private.transfer_view(v_appt, v_settings, v_total);
end;
$$;

-- What the guest's page shows. Bank details only while the transfer is awaited.
create function private.transfer_view(p_appt public.appointments, p_settings public.business_settings, p_total bigint default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'token', p_appt.transfer_token,
    'reference', p_appt.reference,
    'status', case
      when p_appt.status = 'pending_payment' then 'awaiting'
      when p_appt.status in ('confirmed', 'completed') then 'confirmed'
      else 'cancelled'
    end,
    'expired', p_appt.status = 'cancelled' and p_appt.cancelled_by is null and p_appt.transfer_received_at is null,
    'starts_at', p_appt.starts_at,
    'ends_at', p_appt.ends_at,
    'amount_minor', p_appt.transfer_amount_minor,
    'booking_total_minor', coalesce(p_total, p_appt.price_minor + p_appt.dispatch_fee_minor),
    'currency', p_appt.currency,
    'due_at', p_appt.transfer_due_at,
    'bank', case when p_appt.status = 'pending_payment' then jsonb_build_object(
      'name', p_settings.bank_name, 'account_number', p_settings.bank_account_number, 'account_name', p_settings.bank_account_name
    ) end
  );
$$;

-- The guest's page asks for the booking's current state (server-side code only).
create function public.get_transfer_booking(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments;
  v_settings public.business_settings;
begin
  select * into v_appt from public.appointments a where a.transfer_token = p_token and a.settlement = 'bank_transfer';
  if not found then
    return null;
  end if;
  select * into v_settings from public.business_settings;
  return private.transfer_view(v_appt, v_settings);
end;
$$;

-- =========================================================================
-- 3. Unconfirmed transfers lapse (maintenance job, every minute)
-- =========================================================================
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

  -- [transfer] A transfer not confirmed in time: the booking is cancelled and its time is free.
  perform private.audit_label('appointment.transfer_expired', 'Bank transfer not confirmed in time');
  with lapsed as (
    select a.id from public.appointments a
    where a.settlement = 'bank_transfer' and a.status = 'pending_payment' and a.transfer_due_at <= clock_timestamp()
    order by a.id
    for update skip locked
  )
  update public.appointments a
     set status = 'cancelled', cancelled_at = clock_timestamp(), cancellation_reason = 'Bank transfer not confirmed in time'
    from lapsed where a.id = lapsed.id;
  perform private.audit_clear();

  delete from private.rate_limit_hits where window_start < clock_timestamp() - interval '1 day';
  return v_released;
end;
$$;

-- =========================================================================
-- 4. Staff: transfers to check, and confirming one
-- =========================================================================
create function public.staff_transfers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'appointment_id', a.id, 'reference', a.reference, 'starts_at', a.starts_at, 'service_name', s.name,
      'contact_name', coalesce(a.contact_name, c.full_name), 'contact_phone', coalesce(a.contact_phone, c.phone),
      'amount_minor', a.transfer_amount_minor, 'booking_total_minor', a.price_minor + a.dispatch_fee_minor, 'currency', a.currency,
      'due_at', a.transfer_due_at, 'updated_at', a.updated_at
    ) order by a.transfer_due_at, a.id)
    from public.appointments a
    join public.services s on s.id = a.service_id
    join public.customers c on c.id = a.customer_id
    where a.settlement = 'bank_transfer' and a.status = 'pending_payment'
  ), '[]'::jsonb);
end;
$$;

create function public.staff_confirm_transfer(
  p_appointment_id uuid,
  p_expected_updated_at timestamptz,
  p_note text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  v_appt := private.lock_appointment(p_appointment_id, p_expected_updated_at);
  if v_appt.settlement <> 'bank_transfer' or v_appt.status <> 'pending_payment' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  perform private.audit_label('appointment.transfer_received', private.optional_reason(p_note));
  update public.appointments
     set status = 'confirmed', transfer_received_at = clock_timestamp(), transfer_received_by = (select auth.uid())
   where id = v_appt.id
  returning * into v_appt;
  perform private.audit_clear();
  return v_appt;
end;
$$;

-- How a booking is paid, for the staff screens.
create or replace function private.payment_state(p_appt public.appointments)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_appt.settlement
    when 'paid_offline' then 'paid_offline'
    when 'pay_at_venue' then 'to_collect'
    -- [transfer]
    when 'bank_transfer' then case
      when p_appt.transfer_received_at is not null then 'paid_transfer'
      when p_appt.status = 'pending_payment' then 'awaiting_transfer'
      else 'unpaid'
    end
    else coalesce((
      select case
        when p.needs_refund then 'refund_due'
        when p.status = 'refunded' then 'refunded'
        when p.kind = 'deposit' then 'deposit_paid'
        else 'paid'
      end
      from public.payments p
      where p.appointment_id = p_appt.id and p.status in ('succeeded', 'partially_refunded', 'refunded')
      order by p.created_at desc
      limit 1
    ), 'unpaid')
  end;
$$;

-- Settlement changes are for phone and WhatsApp bookings only (now also refusing bank transfer).
create or replace function public.staff_set_settlement(
  p_appointment_id uuid,
  p_settlement public.booking_settlement,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_appt public.appointments;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  v_reason := private.require_reason(p_reason);
  v_appt := private.lock_appointment(p_appointment_id, p_expected_updated_at);
  if v_appt.settlement in ('online_payment', 'bank_transfer') or p_settlement is null
     or p_settlement in ('online_payment', 'bank_transfer') then
    raise exception 'invalid_source' using errcode = 'P0001';
  end if;
  if p_settlement = v_appt.settlement then
    return v_appt;
  end if;
  perform private.audit_label('appointment.settlement_changed', v_reason);
  update public.appointments set settlement = p_settlement where id = v_appt.id returning * into v_appt;
  perform private.audit_clear();
  return v_appt;
end;
$$;

-- =========================================================================
-- 5. Settings: owner changes the account; owner and admin see it
-- =========================================================================
create or replace function public.staff_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  return (
    select jsonb_build_object(
      'business_name', bs.business_name, 'timezone', bs.timezone, 'currency', bs.currency,
      'online_payment_enabled', bs.online_payment_enabled, 'payment_mode', bs.payment_mode,
      'deposit_percent', bs.deposit_percent, 'allow_demo_payments', bs.allow_demo_payments, 'updated_at', bs.updated_at,
      -- [transfer]
      'transfer_enabled', bs.transfer_enabled, 'bank_name', bs.bank_name, 'bank_account_number', bs.bank_account_number,
      'bank_account_name', bs.bank_account_name, 'transfer_hold_minutes', bs.transfer_hold_minutes
    )
    from public.business_settings bs
  );
end;
$$;

create function public.owner_update_transfer_settings(
  p_expected_updated_at timestamptz,
  p_reason text,
  p_enabled boolean,
  p_bank_name text,
  p_account_number text,
  p_account_name text
)
returns public.business_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.business_settings;
  v_reason text;
  v_bank text := nullif(trim(coalesce(p_bank_name, '')), '');
  v_number text := nullif(regexp_replace(coalesce(p_account_number, ''), '\s', '', 'g'), '');
  v_holder text := nullif(trim(coalesce(p_account_name, '')), '');
begin
  perform private.require_staff(array['owner']::public.staff_role[]);
  v_reason := private.require_reason(p_reason);
  if p_enabled is null
     or (v_bank is not null and length(v_bank) not between 2 and 80)
     or (v_number is not null and v_number !~ '^[0-9]{6,20}$')
     or (v_holder is not null and length(v_holder) not between 2 and 120)
     or (p_enabled and (v_bank is null or v_number is null or v_holder is null)) then
    raise exception 'invalid_transfer_settings' using errcode = 'P0001';
  end if;
  select * into v_settings from public.business_settings for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_current(v_settings.updated_at, p_expected_updated_at);
  perform private.audit_label('settings.transfer_settings_changed', v_reason);
  update public.business_settings
     set transfer_enabled = p_enabled, bank_name = v_bank, bank_account_number = v_number, bank_account_name = v_holder
  returning * into v_settings;
  perform private.audit_clear();
  return v_settings;
end;
$$;

-- =========================================================================
-- Privileges
-- =========================================================================
revoke execute on function private.transfer_view(public.appointments, public.business_settings, bigint) from public;

revoke execute on function
  public.request_transfer_booking(uuid, text, text),
  public.get_transfer_booking(uuid)
from public, anon, authenticated;
grant execute on function
  public.request_transfer_booking(uuid, text, text),
  public.get_transfer_booking(uuid)
to service_role;

revoke execute on function
  public.staff_transfers(),
  public.staff_confirm_transfer(uuid, timestamptz, text),
  public.owner_update_transfer_settings(timestamptz, text, boolean, text, text, text)
from public, anon;
grant execute on function
  public.staff_transfers(),
  public.staff_confirm_transfer(uuid, timestamptz, text),
  public.owner_update_transfer_settings(timestamptz, text, boolean, text, text, text)
to authenticated;
