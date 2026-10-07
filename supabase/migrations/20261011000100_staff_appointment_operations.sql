-- Phase 5b: appointment and customer operations for staff.
--
--   1. Bookings say where they came from (online, phone, WhatsApp) and how
--      they are settled (online payment, pay at venue, paid offline). Phone and
--      WhatsApp bookings never touch the provider-verified payment ledger.
--   2. Staff actions on appointments: create (phone/WhatsApp), reschedule,
--      cancel, complete/no-show, booking details, settlement. Each checks the
--      caller's role, the record's version, and is audited with a named action.
--   3. Customer master records change only through their own functions,
--      separately from the contact details kept on each booking.
--   4. Read functions for the staff screens. Therapists see only their own
--      appointments, through therapist_agenda(), never the tables.
--
-- Lock order, as everywhere else:
--   schedule-rules lock -> therapist locks (by id) -> booking_holds row
--   -> appointments row -> payments rows.

-- =========================================================================
-- 1. Source and settlement
-- =========================================================================
create type public.booking_source as enum ('online', 'phone', 'whatsapp');
create type public.booking_settlement as enum ('online_payment', 'pay_at_venue', 'paid_offline');

alter table public.appointments
  add column source public.booking_source not null default 'online',
  add column settlement public.booking_settlement not null default 'online_payment',
  -- Notes from staff about this booking, shown to its therapist. Not the
  -- customer master's staff_notes, which therapists never see.
  add column booking_notes text check (booking_notes is null or length(booking_notes) <= 2000),
  add column created_by uuid references public.profiles (id) on delete set null,
  add column cancelled_by uuid references public.profiles (id) on delete set null,
  -- Only online bookings are settled by online payment; staff bookings never are.
  add constraint appointments_source_settlement check ((source = 'online') = (settlement = 'online_payment'));

-- Phone and WhatsApp customers may have no email address.
alter table public.customers
  alter column email drop not null,
  add constraint customers_contact_required check (email is not null or phone is not null);

-- A cancelled, paid online booking is flagged for a refund (never refunded here).
alter table public.payments
  drop constraint payments_needs_refund_reason_check,
  add constraint payments_needs_refund_reason_check check (
    needs_refund_reason in (
      'slot_retaken', 'hold_released', 'slot_passed', 'amount_mismatch', 'currency_mismatch',
      'duplicate_payment', 'hold_missing', 'schedule_changed', 'service_changed', 'therapist_unavailable',
      'appointment_cancelled'
    )
  );

-- The provider-verified ledger and staff bookings stay apart: a payment can
-- only ever be attached to a booking that is settled by online payment.
create function private.guard_payment_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.appointment_id is not null
     and (tg_op = 'INSERT' or new.appointment_id is distinct from old.appointment_id)
     and exists (
       select 1 from public.appointments a
       where a.id = new.appointment_id and a.settlement <> 'online_payment'
     ) then
    raise exception 'ledger_separation' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger guard_payment_appointment
  before insert or update of appointment_id on public.payments
  for each row execute function private.guard_payment_appointment();

-- Booking notes may name people or health matters: audited without values.
insert into private.audit_personal_columns (entity_type, column_name) values ('appointments', 'booking_notes');

-- =========================================================================
-- 2. Therapists see appointments only through their agenda
-- =========================================================================
-- Direct reads exposed every column (customer id, prices, cancellation
-- reasons, who created it). The agenda returns only what treatment needs.
drop policy "therapist read own" on public.appointments;

-- Intake answers (Phase 6) stay readable by the appointment's therapist; the
-- check no longer depends on reading the appointments table.
create function private.is_own_appointment(p_appointment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.appointments a
    where a.id = p_appointment_id and a.therapist_id = private.therapist_id()
  );
$$;

drop policy "therapist read own intake" on public.appointment_intake_answers;
create policy "therapist read own intake" on public.appointment_intake_answers for select to authenticated
  using ((select private.therapist_id()) is not null and private.is_own_appointment(appointment_id));

-- Customer master records change only through the functions below (with
-- version checks); reads stay owner/admin through RLS.
revoke insert, update on public.customers from authenticated;

-- =========================================================================
-- 3. Shared checks
-- =========================================================================

-- Another live reservation on the therapist's time, other than this appointment.
create function private.reservation_conflict(
  p_therapist_id uuid,
  p_starts_at timestamptz,
  p_blocked_until timestamptz,
  p_ignore_appointment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.appointments a
    where a.therapist_id = p_therapist_id
      and a.id is distinct from p_ignore_appointment_id
      and a.status in ('pending_payment', 'confirmed', 'completed')
      and tstzrange(a.starts_at, a.blocked_until) && tstzrange(p_starts_at, p_blocked_until)
  ) or exists (
    select 1 from public.booking_holds h
    where h.therapist_id = p_therapist_id
      and h.status = 'active'
      and h.expires_at > clock_timestamp()
      and tstzrange(h.starts_at, h.blocked_until) && tstzrange(p_starts_at, p_blocked_until)
  );
$$;

create function private.valid_phone(p_phone text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_phone ~ '^\+?[0-9][0-9 ()-]{6,19}$';
$$;

create function private.valid_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(p_email) <= 254;
$$;

-- Locks an appointment for a staff change and checks the version the screen showed.
create function private.lock_appointment(p_appointment_id uuid, p_expected_updated_at timestamptz)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments;
begin
  select * into v_appt from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_current(v_appt.updated_at, p_expected_updated_at);
  return v_appt;
end;
$$;

-- Optional reason: trimmed, at most 500 characters, null when blank.
create function private.optional_reason(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(trim(coalesce(p_reason, '')), 500), '');
$$;

-- =========================================================================
-- 4. Staff actions on appointments
-- =========================================================================

-- Owner/admin: a booking taken by phone or WhatsApp. It goes through exactly
-- the same path as an online booking up to the point of payment: the
-- availability rules, the therapist locks, the hold and the overlap
-- safeguards (request_booking_hold), under the schedule-rules lock. It is
-- then confirmed directly, without any payment record: settlement says
-- whether the guest pays at the venue or has already paid offline.
create function public.staff_create_booking(
  p_source public.booking_source,
  p_settlement public.booking_settlement,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_reason text,
  p_therapist_id uuid default null,
  p_location_type public.location_type default 'sanctuary',
  p_dispatch_zone_id uuid default null,
  p_service_address text default null,
  p_customer_id uuid default null,
  p_customer_name text default null,
  p_customer_email text default null,
  p_customer_phone text default null,
  p_contact_name text default null,
  p_contact_phone text default null,
  p_booking_notes text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := private.require_reason(p_reason);
  v_customer public.customers;
  v_name text := trim(coalesce(p_customer_name, ''));
  v_email text := nullif(lower(trim(coalesce(p_customer_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_customer_phone, '')), '');
  v_contact_name text;
  v_contact_phone text;
  v_address text := nullif(trim(coalesce(p_service_address, '')), '');
  v_notes text := nullif(trim(coalesce(p_booking_notes, '')), '');
  v_hold public.booking_holds;
  v_service public.services;
  v_fee bigint := 0;
  v_appt public.appointments;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);

  if p_source is null or p_source = 'online' or p_settlement is null or p_settlement = 'online_payment' then
    raise exception 'invalid_source' using errcode = 'P0001';
  end if;
  if p_location_type = 'mobile' and (v_address is null or length(v_address) > 300) then
    raise exception 'address_required' using errcode = 'P0001';
  end if;
  if p_location_type = 'sanctuary' then
    v_address := null;
  end if;
  if length(v_notes) > 2000 then
    raise exception 'invalid_booking' using errcode = 'P0001';
  end if;

  -- The customer: an existing record, or a new one. A new guest whose email
  -- is already on file is linked to that record, which is left unchanged.
  if p_customer_id is not null then
    select * into v_customer from public.customers c where c.id = p_customer_id;
    if not found then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
  else
    if length(v_name) < 2 or length(v_name) > 120
       or (v_email is null and v_phone is null)
       or (v_email is not null and not private.valid_email(v_email))
       or (v_phone is not null and not private.valid_phone(v_phone)) then
      raise exception 'invalid_customer' using errcode = 'P0001';
    end if;
    if v_email is not null then
      select * into v_customer from public.customers c where lower(c.email) = v_email;
    end if;
  end if;

  -- The contact for this booking (what the therapist sees). Defaults to the
  -- details just given, then to the customer record.
  v_contact_name := coalesce(nullif(trim(coalesce(p_contact_name, '')), ''), nullif(v_name, ''), v_customer.full_name);
  v_contact_phone := coalesce(nullif(trim(coalesce(p_contact_phone, '')), ''), v_phone, v_customer.phone);
  if v_contact_name is null or length(v_contact_name) < 2 or length(v_contact_name) > 120
     or v_contact_phone is null or not private.valid_phone(v_contact_phone) then
    raise exception 'invalid_contact' using errcode = 'P0001';
  end if;

  -- Same locks and rules as an online booking.
  perform pg_advisory_xact_lock_shared(private.schedule_rules_lock_key());
  v_hold := public.request_booking_hold(p_service_id, p_starts_at, p_therapist_id, p_location_type, p_dispatch_zone_id, null);

  if v_customer.id is null then
    perform private.audit_label('customer.created', v_reason, jsonb_build_object('source', p_source));
    insert into public.customers (full_name, email, phone)
    values (v_name, v_email, v_phone)
    returning * into v_customer;
    perform private.audit_clear();
  end if;

  select * into v_service from public.services s where s.id = v_hold.service_id;
  if v_hold.location_type = 'mobile' then
    select coalesce(z.fee_minor, 0) into v_fee from public.dispatch_zones z where z.id = v_hold.dispatch_zone_id;
    v_fee := coalesce(v_fee, 0);
  end if;

  perform private.audit_label('appointment.created_by_staff', v_reason,
    jsonb_build_object('source', p_source, 'settlement', p_settlement));
  insert into public.appointments (
    customer_id, service_id, therapist_id, hold_id, starts_at, ends_at, blocked_until, status,
    location_type, dispatch_zone_id, service_address, price_minor, dispatch_fee_minor, currency,
    contact_name, contact_phone, booking_notes, source, settlement, created_by
  )
  values (
    v_customer.id, v_hold.service_id, v_hold.therapist_id, v_hold.id, v_hold.starts_at, v_hold.ends_at,
    v_hold.blocked_until, 'confirmed', v_hold.location_type, v_hold.dispatch_zone_id, v_address,
    v_service.price_minor, v_fee, v_service.currency,
    v_contact_name, v_contact_phone, v_notes, p_source, p_settlement, (select auth.uid())
  )
  returning * into v_appt;
  perform private.audit_clear();

  update public.booking_holds set status = 'converted' where id = v_hold.id;
  return v_appt;
end;
$$;

-- Owner/admin: move an appointment to another time and/or therapist.
-- Overlaps are never allowed. A scheduling rule (opening hours, shift, break,
-- time off, blackout, notice, booking window, grid) may be overridden only
-- when p_override is true; the override and the rule are recorded.
create function public.staff_reschedule_appointment(
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_reason text,
  p_expected_updated_at timestamptz,
  p_therapist_id uuid default null,
  p_override boolean default false
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := private.require_reason(p_reason);
  v_appt public.appointments;
  v_current_therapist uuid;
  v_therapist uuid;
  v_ends_at timestamptz;
  v_blocked_until timestamptz;
  v_rule text;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  if p_starts_at is null then
    raise exception 'invalid_time' using errcode = 'P0001';
  end if;

  -- Read without locking, only to know which locks to take.
  select a.therapist_id into v_current_therapist from public.appointments a where a.id = p_appointment_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  v_therapist := coalesce(p_therapist_id, v_current_therapist);

  perform pg_advisory_xact_lock_shared(private.schedule_rules_lock_key());
  perform private.lock_therapist(t.id)
  from (select distinct x as id from unnest(array[v_current_therapist, v_therapist]) as x order by 1) t;
  v_appt := private.lock_appointment(p_appointment_id, p_expected_updated_at);
  -- (A therapist change committed in between would have changed the version.)

  if v_appt.status not in ('pending_payment', 'confirmed') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if v_appt.starts_at <= clock_timestamp() then
    raise exception 'appointment_started' using errcode = 'P0001';
  end if;
  if p_starts_at <= clock_timestamp() then
    raise exception 'start_in_past' using errcode = 'P0001';
  end if;
  if v_therapist = v_appt.therapist_id and p_starts_at = v_appt.starts_at then
    return v_appt;
  end if;
  -- Not a scheduling rule: never overridden.
  if not exists (
    select 1 from public.therapists t
    join public.therapist_services ts on ts.therapist_id = t.id
    where t.id = v_therapist and t.is_active and ts.service_id = v_appt.service_id
  ) then
    raise exception 'therapist_unavailable' using errcode = 'P0001';
  end if;

  -- The booking keeps its own length and turnover buffer.
  v_ends_at := p_starts_at + (v_appt.ends_at - v_appt.starts_at);
  v_blocked_until := v_ends_at + (v_appt.blocked_until - v_appt.ends_at);

  if private.reservation_conflict(v_therapist, p_starts_at, v_blocked_until, v_appt.id) then
    raise exception 'slot_unavailable' using errcode = '23P01', detail = 'slot_taken';
  end if;

  v_rule := private.slot_block_reason(v_therapist, p_starts_at, v_ends_at, v_blocked_until, clock_timestamp(), null);
  if v_rule = 'slot_taken' then
    v_rule := null; -- every rule passed; the only overlap found was this appointment itself
  end if;
  if v_rule = 'not_configured' or (v_rule is not null and not coalesce(p_override, false)) then
    raise exception 'schedule_rule' using errcode = 'P0001', detail = v_rule;
  end if;

  perform private.audit_label('appointment.rescheduled', v_reason,
    case when v_rule is null then '{}'::jsonb else jsonb_build_object('override', true, 'overridden_rule', v_rule) end);
  begin
    update public.appointments
       set starts_at = p_starts_at, ends_at = v_ends_at, blocked_until = v_blocked_until, therapist_id = v_therapist
     where id = v_appt.id
    returning * into v_appt;
  exception
    when exclusion_violation then
      raise exception 'slot_unavailable' using errcode = '23P01', detail = 'slot_taken';
  end;
  perform private.audit_clear();
  return v_appt;
end;
$$;

-- Owner/admin: cancel with a reason. The time is free again at once. A booking
-- paid online is flagged for a refund; no refund is ever issued here.
create function public.staff_cancel_appointment(
  p_appointment_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := private.require_reason(p_reason);
  v_appt public.appointments;
  v_flagged uuid[];
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  v_appt := private.lock_appointment(p_appointment_id, p_expected_updated_at);
  if v_appt.status not in ('pending_payment', 'confirmed') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  with flagged as (
    update public.payments p
       set needs_refund = true, needs_refund_reason = 'appointment_cancelled', needs_refund_detail = null
     where p.appointment_id = v_appt.id
       and p.status in ('succeeded', 'partially_refunded')
       and p.refundable_minor > 0
       and not p.needs_refund
    returning p.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_flagged from flagged;

  perform private.audit_label('appointment.cancelled', v_reason,
    case when cardinality(v_flagged) > 0 then jsonb_build_object('refund_flagged_payments', to_jsonb(v_flagged)) else '{}'::jsonb end);
  update public.appointments
     set status = 'cancelled', cancelled_at = clock_timestamp(), cancellation_reason = v_reason,
         cancelled_by = (select auth.uid())
   where id = v_appt.id
  returning * into v_appt;
  perform private.audit_clear();

  return jsonb_build_object(
    'appointment_id', v_appt.id,
    'status', v_appt.status,
    'updated_at', v_appt.updated_at,
    'settlement', v_appt.settlement,
    'refund_flagged', cardinality(v_flagged)
  );
end;
$$;

-- Completed / no-show, once the appointment has started:
--   * the appointment's own therapist, or owner/admin, from confirmed;
--   * owner/admin only, with a reason, to correct a completed / no-show
--     appointment (including back to confirmed).
create function public.staff_set_appointment_status(
  p_appointment_id uuid,
  p_status public.appointment_status,
  p_expected_updated_at timestamptz,
  p_reason text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.staff_role;
  v_appt public.appointments;
  v_reason text := private.optional_reason(p_reason);
  v_action text;
  v_correction boolean;
begin
  v_role := private.require_staff(array['owner', 'admin', 'therapist']::public.staff_role[]);
  v_appt := private.lock_appointment(p_appointment_id, p_expected_updated_at);
  if v_role = 'therapist' and v_appt.therapist_id is distinct from private.therapist_id() then
    raise exception 'not_found' using errcode = 'P0001'; -- not theirs: do not confirm it exists
  end if;

  if p_status not in ('completed', 'no_show', 'confirmed') or p_status = v_appt.status then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  v_correction := v_appt.status in ('completed', 'no_show');
  if not v_correction and not (v_appt.status = 'confirmed' and p_status in ('completed', 'no_show')) then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if v_appt.starts_at > clock_timestamp() then
    raise exception 'not_started' using errcode = 'P0001';
  end if;
  if v_correction then
    if v_role = 'therapist' then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
    v_reason := private.require_reason(p_reason);
  end if;

  v_action := case
    when v_correction then 'appointment.status_corrected'
    when p_status = 'completed' then 'appointment.completed'
    else 'appointment.no_show'
  end;
  perform private.audit_label(v_action, v_reason);
  begin
    update public.appointments set status = p_status where id = v_appt.id returning * into v_appt;
  exception
    when exclusion_violation then -- back to confirmed, but the time has been taken since
      raise exception 'slot_unavailable' using errcode = '23P01', detail = 'slot_taken';
  end;
  perform private.audit_clear();
  return v_appt;
end;
$$;

-- Owner/admin: the contact details, address and notes of one booking. Never
-- touches the customer master record.
create function public.staff_update_booking_details(
  p_appointment_id uuid,
  p_expected_updated_at timestamptz,
  p_contact_name text,
  p_contact_phone text,
  p_service_address text default null,
  p_booking_notes text default null,
  p_reason text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments;
  v_name text := trim(coalesce(p_contact_name, ''));
  v_phone text := trim(coalesce(p_contact_phone, ''));
  v_address text := nullif(trim(coalesce(p_service_address, '')), '');
  v_notes text := nullif(trim(coalesce(p_booking_notes, '')), '');
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  v_appt := private.lock_appointment(p_appointment_id, p_expected_updated_at);
  if v_appt.status = 'cancelled' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 or not private.valid_phone(v_phone) then
    raise exception 'invalid_contact' using errcode = 'P0001';
  end if;
  if v_appt.location_type = 'mobile' and (v_address is null or length(v_address) > 300) then
    raise exception 'address_required' using errcode = 'P0001';
  end if;
  if v_appt.location_type = 'sanctuary' and v_address is not null then
    raise exception 'address_not_applicable' using errcode = 'P0001';
  end if;
  if length(v_notes) > 2000 then
    raise exception 'invalid_booking' using errcode = 'P0001';
  end if;

  perform private.audit_label('appointment.details_updated', private.optional_reason(p_reason));
  update public.appointments
     set contact_name = v_name, contact_phone = v_phone,
         service_address = case when location_type = 'mobile' then v_address else service_address end,
         booking_notes = v_notes
   where id = v_appt.id
  returning * into v_appt;
  perform private.audit_clear();
  return v_appt;
end;
$$;

-- Owner/admin: record that a phone or WhatsApp booking was paid offline (or
-- correct it back to pay at venue). Online bookings are settled only by the
-- payment ledger and cannot be changed here.
create function public.staff_set_settlement(
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
  v_reason text := private.require_reason(p_reason);
  v_appt public.appointments;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  v_appt := private.lock_appointment(p_appointment_id, p_expected_updated_at);
  if v_appt.settlement = 'online_payment' or p_settlement is null or p_settlement = 'online_payment' then
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
-- 5. Customer master records
-- =========================================================================
create function private.check_customer(p_name text, p_email text, p_phone text, p_notes text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if length(p_name) < 2 or length(p_name) > 120
     or (p_email is null and p_phone is null)
     or (p_email is not null and not private.valid_email(p_email))
     or (p_phone is not null and not private.valid_phone(p_phone))
     or length(p_notes) > 2000 then
    raise exception 'invalid_customer' using errcode = 'P0001';
  end if;
end;
$$;

create function public.staff_create_customer(
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_staff_notes text default null
)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_full_name, ''));
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_notes text := nullif(trim(coalesce(p_staff_notes, '')), '');
  v_customer public.customers;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  perform private.check_customer(v_name, v_email, v_phone, v_notes);
  perform private.audit_label('customer.created');
  begin
    insert into public.customers (full_name, email, phone, staff_notes)
    values (v_name, v_email, v_phone, v_notes)
    returning * into v_customer;
  exception
    when unique_violation then
      raise exception 'email_in_use' using errcode = 'P0001';
  end;
  perform private.audit_clear();
  return v_customer;
end;
$$;

create function public.staff_update_customer(
  p_customer_id uuid,
  p_expected_updated_at timestamptz,
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_staff_notes text default null,
  p_reason text default null
)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_full_name, ''));
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_notes text := nullif(trim(coalesce(p_staff_notes, '')), '');
  v_customer public.customers;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  select * into v_customer from public.customers c where c.id = p_customer_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_current(v_customer.updated_at, p_expected_updated_at);
  perform private.check_customer(v_name, v_email, v_phone, v_notes);
  perform private.audit_label('customer.updated', private.optional_reason(p_reason));
  begin
    update public.customers
       set full_name = v_name, email = v_email, phone = v_phone, staff_notes = v_notes
     where id = v_customer.id
    returning * into v_customer;
  exception
    when unique_violation then
      raise exception 'email_in_use' using errcode = 'P0001';
  end;
  perform private.audit_clear();
  return v_customer;
end;
$$;

-- =========================================================================
-- 6. Reads for the staff screens (owner/admin)
-- =========================================================================

-- How a booking stands financially, in one word.
create function private.payment_state(p_appt public.appointments)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_appt.settlement
    when 'paid_offline' then 'paid_offline'
    when 'pay_at_venue' then 'to_collect'
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

create function private.check_range(p_from timestamptz, p_to timestamptz)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;
end;
$$;

create function public.staff_appointments(
  p_from timestamptz,
  p_to timestamptz,
  p_therapist_id uuid default null
)
returns table (
  appointment_id uuid,
  reference text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  source public.booking_source,
  settlement public.booking_settlement,
  payment_state text,
  service_name text,
  therapist_id uuid,
  therapist_name text,
  location_type public.location_type,
  zone_name text,
  customer_id uuid,
  customer_name text,
  contact_name text,
  contact_phone text,
  total_minor bigint,
  currency text,
  is_demo boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  perform private.check_range(p_from, p_to);
  return query
  select a.id, a.reference, a.starts_at, a.ends_at, a.status, a.source, a.settlement, private.payment_state(a),
         s.name, a.therapist_id, t.display_name, a.location_type, z.name, a.customer_id, c.full_name,
         coalesce(a.contact_name, c.full_name), coalesce(a.contact_phone, c.phone),
         a.total_minor, a.currency::text, a.is_demo, a.updated_at
  from public.appointments a
  join public.services s on s.id = a.service_id
  join public.therapists t on t.id = a.therapist_id
  join public.customers c on c.id = a.customer_id
  left join public.dispatch_zones z on z.id = a.dispatch_zone_id
  where a.starts_at >= p_from and a.starts_at < p_to
    and (p_therapist_id is null or a.therapist_id = p_therapist_id)
  order by a.starts_at, t.sort_order;
end;
$$;

-- Everything about one appointment, including its audit history. Payment
-- details are read-only and never include checkout links.
create function public.staff_appointment_detail(p_appointment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  select * into v_appt from public.appointments a where a.id = p_appointment_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'appointment', jsonb_build_object(
      'id', v_appt.id, 'reference', v_appt.reference, 'status', v_appt.status,
      'starts_at', v_appt.starts_at, 'ends_at', v_appt.ends_at, 'blocked_until', v_appt.blocked_until,
      'source', v_appt.source, 'settlement', v_appt.settlement, 'payment_state', private.payment_state(v_appt),
      'service_id', v_appt.service_id, 'therapist_id', v_appt.therapist_id,
      'location_type', v_appt.location_type, 'dispatch_zone_id', v_appt.dispatch_zone_id,
      'service_address', v_appt.service_address, 'contact_name', v_appt.contact_name,
      'contact_phone', v_appt.contact_phone, 'customer_notes', v_appt.customer_notes,
      'booking_notes', v_appt.booking_notes, 'price_minor', v_appt.price_minor,
      'dispatch_fee_minor', v_appt.dispatch_fee_minor, 'total_minor', v_appt.total_minor,
      'currency', v_appt.currency, 'cancelled_at', v_appt.cancelled_at,
      'cancellation_reason', v_appt.cancellation_reason, 'is_demo', v_appt.is_demo,
      'created_at', v_appt.created_at, 'updated_at', v_appt.updated_at,
      'service_name', (select s.name from public.services s where s.id = v_appt.service_id),
      'therapist_name', (select t.display_name from public.therapists t where t.id = v_appt.therapist_id),
      'zone_name', (select z.name from public.dispatch_zones z where z.id = v_appt.dispatch_zone_id),
      'created_by_name', (select p.full_name from public.profiles p where p.id = v_appt.created_by)
    ),
    'customer', (
      select jsonb_build_object('id', c.id, 'full_name', c.full_name, 'email', c.email, 'phone', c.phone)
      from public.customers c where c.id = v_appt.customer_id
    ),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', p.provider, 'reference', p.provider_reference, 'kind', p.kind, 'status', p.status,
        'amount_minor', p.amount_minor, 'paid_minor', p.paid_minor, 'refunded_minor', p.refunded_minor,
        'currency', p.currency, 'paid_at', p.paid_at, 'needs_refund', p.needs_refund,
        'needs_refund_reason', p.needs_refund_reason, 'refund_status', p.refund_status,
        'is_test', p.is_test, 'is_demo', p.is_demo
      ) order by p.created_at)
      from public.payments p where p.appointment_id = v_appt.id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'occurred_at', l.occurred_at, 'action', l.action, 'actor_kind', l.actor_kind,
        'actor_name', (select p.full_name from public.profiles p where p.id = l.actor_id),
        'actor_role', l.actor_role, 'changes', l.changes, 'reason', l.reason, 'context', l.context
      ) order by l.id)
      from public.audit_log l where l.entity_type = 'appointments' and l.entity_id = v_appt.id::text
    ), '[]'::jsonb)
  );
end;
$$;

-- Customer directory with search (name, email or phone digits).
create function public.staff_customer_directory(
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  customer_id uuid,
  full_name text,
  email text,
  phone text,
  appointment_count bigint,
  last_visit timestamptz,
  next_visit timestamptz,
  is_demo boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(trim(coalesce(p_query, '')));
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  if p_limit is null or p_limit < 1 or p_limit > 200 or p_offset is null or p_offset < 0 then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;
  return query
  with matches as (
    select c.* from public.customers c
    where v_q = ''
       or strpos(lower(c.full_name), v_q) > 0
       or strpos(lower(coalesce(c.email, '')), v_q) > 0
       or (length(v_digits) >= 3 and strpos(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), v_digits) > 0)
  )
  select m.id, m.full_name, m.email, m.phone,
         (select count(*) from public.appointments a where a.customer_id = m.id and a.status <> 'cancelled'),
         (select max(a.starts_at) from public.appointments a
           where a.customer_id = m.id and a.status in ('confirmed', 'completed') and a.starts_at <= clock_timestamp()),
         (select min(a.starts_at) from public.appointments a
           where a.customer_id = m.id and a.status in ('pending_payment', 'confirmed') and a.starts_at > clock_timestamp()),
         m.is_demo,
         count(*) over ()
  from matches m
  order by lower(m.full_name), m.id
  limit p_limit offset p_offset;
end;
$$;

-- One customer's master record and booking history. Each booking shows the
-- contact given for it, which may differ from the master record.
create function public.staff_customer_detail(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  select * into v_customer from public.customers c where c.id = p_customer_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'customer', jsonb_build_object(
      'id', v_customer.id, 'full_name', v_customer.full_name, 'email', v_customer.email,
      'phone', v_customer.phone, 'staff_notes', v_customer.staff_notes, 'is_demo', v_customer.is_demo,
      'created_at', v_customer.created_at, 'updated_at', v_customer.updated_at
    ),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'reference', a.reference, 'starts_at', a.starts_at, 'status', a.status,
        'source', a.source, 'settlement', a.settlement, 'payment_state', private.payment_state(a),
        'service_name', s.name, 'therapist_name', t.display_name,
        'contact_name', a.contact_name, 'contact_phone', a.contact_phone,
        'total_minor', a.total_minor, 'currency', a.currency
      ) order by a.starts_at desc)
      from public.appointments a
      join public.services s on s.id = a.service_id
      join public.therapists t on t.id = a.therapist_id
      where a.customer_id = v_customer.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Today's figures for the staff home screen, in the business timezone.
create function public.staff_dashboard()
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
      )
    )
    from public.appointments a
    where a.starts_at >= v_from and a.starts_at < v_to
  );
end;
$$;

-- Options for the staff booking form: active services and therapists, and
-- which therapist offers which service.
create function public.staff_booking_options()
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
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration_minutes', s.duration_minutes,
        'price_minor', s.price_minor, 'currency', s.currency) order by s.sort_order, s.name)
      from public.services s where s.is_active
    ), '[]'::jsonb),
    'therapists', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name,
        'service_ids', coalesce((select jsonb_agg(ts.service_id) from public.therapist_services ts where ts.therapist_id = t.id), '[]'::jsonb))
        order by t.sort_order, t.display_name)
      from public.therapists t where t.is_active
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'fee_minor', z.fee_minor) order by z.sort_order)
      from public.dispatch_zones z where z.is_active
    ), '[]'::jsonb),
    'timezone', coalesce((select bs.timezone from public.business_settings bs), 'Africa/Lagos')
  );
end;
$$;

-- =========================================================================
-- 7. The therapist's agenda (replaces the 5a version)
-- =========================================================================
-- Adds the booking's source, staff booking notes and the version needed to
-- mark it completed / no-show. Payment shows only paid / deposit paid / to
-- collect: no amounts, no provider details.
drop function public.therapist_agenda(timestamptz, timestamptz);

create function public.therapist_agenda(p_from timestamptz, p_to timestamptz)
returns table (
  appointment_id uuid,
  reference text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  service_name text,
  duration_minutes integer,
  location_type public.location_type,
  zone_name text,
  service_address text,
  contact_name text,
  contact_phone text,
  customer_notes text,
  booking_notes text,
  source public.booking_source,
  payment_state text,
  is_demo boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_therapist uuid := private.therapist_id();
begin
  if v_therapist is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform private.check_range(p_from, p_to);
  return query
  select a.id, a.reference, a.starts_at, a.ends_at, a.status, s.name,
         (extract(epoch from a.ends_at - a.starts_at) / 60)::integer,
         a.location_type, z.name, a.service_address,
         coalesce(a.contact_name, c.full_name), coalesce(a.contact_phone, c.phone),
         a.customer_notes, a.booking_notes, a.source,
         case private.payment_state(a)
           when 'paid' then 'paid'
           when 'paid_offline' then 'paid'
           when 'deposit_paid' then 'deposit_paid'
           else 'to_collect'
         end,
         a.is_demo, a.updated_at
  from public.appointments a
  join public.services s on s.id = a.service_id
  join public.customers c on c.id = a.customer_id
  left join public.dispatch_zones z on z.id = a.dispatch_zone_id
  where a.therapist_id = v_therapist and a.starts_at >= p_from and a.starts_at < p_to
  order by a.starts_at;
end;
$$;

-- =========================================================================
-- Privileges
-- =========================================================================
revoke execute on function
  private.guard_payment_appointment(), private.is_own_appointment(uuid),
  private.reservation_conflict(uuid, timestamptz, timestamptz, uuid),
  private.valid_phone(text), private.valid_email(text),
  private.lock_appointment(uuid, timestamptz), private.optional_reason(text),
  private.check_customer(text, text, text, text), private.payment_state(public.appointments),
  private.check_range(timestamptz, timestamptz)
from public;
-- Used inside the intake policy, evaluated as the signed-in user.
grant execute on function private.is_own_appointment(uuid) to authenticated, service_role;

revoke execute on function
  public.staff_create_booking(public.booking_source, public.booking_settlement, uuid, timestamptz, text, uuid,
    public.location_type, uuid, text, uuid, text, text, text, text, text, text),
  public.staff_reschedule_appointment(uuid, timestamptz, text, timestamptz, uuid, boolean),
  public.staff_cancel_appointment(uuid, text, timestamptz),
  public.staff_set_appointment_status(uuid, public.appointment_status, timestamptz, text),
  public.staff_update_booking_details(uuid, timestamptz, text, text, text, text, text),
  public.staff_set_settlement(uuid, public.booking_settlement, text, timestamptz),
  public.staff_create_customer(text, text, text, text),
  public.staff_update_customer(uuid, timestamptz, text, text, text, text, text),
  public.staff_appointments(timestamptz, timestamptz, uuid),
  public.staff_appointment_detail(uuid),
  public.staff_customer_directory(text, integer, integer),
  public.staff_customer_detail(uuid),
  public.staff_dashboard(),
  public.staff_booking_options(),
  public.therapist_agenda(timestamptz, timestamptz)
from public, anon;

grant execute on function
  public.staff_create_booking(public.booking_source, public.booking_settlement, uuid, timestamptz, text, uuid,
    public.location_type, uuid, text, uuid, text, text, text, text, text, text),
  public.staff_reschedule_appointment(uuid, timestamptz, text, timestamptz, uuid, boolean),
  public.staff_cancel_appointment(uuid, text, timestamptz),
  public.staff_set_appointment_status(uuid, public.appointment_status, timestamptz, text),
  public.staff_update_booking_details(uuid, timestamptz, text, text, text, text, text),
  public.staff_set_settlement(uuid, public.booking_settlement, text, timestamptz),
  public.staff_create_customer(text, text, text, text),
  public.staff_update_customer(uuid, timestamptz, text, text, text, text, text),
  public.staff_appointments(timestamptz, timestamptz, uuid),
  public.staff_appointment_detail(uuid),
  public.staff_customer_directory(text, integer, integer),
  public.staff_customer_detail(uuid),
  public.staff_dashboard(),
  public.staff_booking_options(),
  public.therapist_agenda(timestamptz, timestamptz)
to authenticated;
