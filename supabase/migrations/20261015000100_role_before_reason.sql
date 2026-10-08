-- Phase 5 hardening: check the caller's role before the reason.
--
-- These staff functions validated the required reason (in their DECLARE
-- section) before checking whether the caller may call them, so a signed-in
-- user without access who left the reason out was told "reason_required"
-- rather than "not_authorized". Each function now checks the role first and
-- only then the reason. Nothing else changes: same signature, same checks,
-- same results for authorised staff, same privileges (create or replace
-- keeps the existing grants).
--
-- Functions: owner_set_staff_role, owner_set_staff_active, owner_link_therapist, staff_update_booking_rules, owner_update_payment_settings, staff_create_booking, staff_reschedule_appointment, staff_cancel_appointment, staff_set_settlement, owner_record_refund.
-- Each body is identical to its previous version except the two lines marked [5e]
-- (the declaration no longer validates; the validation follows the role check).

-- owner_set_staff_role (from 20261010000100_staff_security_foundation.sql)
create or replace function public.owner_set_staff_role(
  p_profile_id uuid,
  p_role public.staff_role,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_reason text;
begin
  perform private.require_staff(array['owner']::public.staff_role[]);
  v_reason := private.require_reason(p_reason); -- [5e] only after the role check
  select * into v_profile from public.profiles p where p.id = p_profile_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_current(v_profile.updated_at, p_expected_updated_at);
  if v_profile.role = p_role then
    return v_profile;
  end if;
  perform private.audit_label('staff.role_changed', v_reason);
  update public.profiles set role = p_role where id = p_profile_id returning * into v_profile;
  perform private.audit_clear();
  return v_profile;
end;
$$;

-- owner_set_staff_active (from 20261010000100_staff_security_foundation.sql)
create or replace function public.owner_set_staff_active(
  p_profile_id uuid,
  p_active boolean,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_reason text;
begin
  perform private.require_staff(array['owner']::public.staff_role[]);
  v_reason := private.require_reason(p_reason); -- [5e] only after the role check
  select * into v_profile from public.profiles p where p.id = p_profile_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_current(v_profile.updated_at, p_expected_updated_at);
  if v_profile.is_active = p_active then
    return v_profile;
  end if;
  perform private.audit_label(case when p_active then 'staff.activated' else 'staff.deactivated' end, v_reason);
  update public.profiles set is_active = p_active where id = p_profile_id returning * into v_profile;
  perform private.audit_clear();
  return v_profile;
end;
$$;

-- owner_link_therapist (from 20261010000100_staff_security_foundation.sql)
create or replace function public.owner_link_therapist(
  p_therapist_id uuid,
  p_profile_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns public.therapists
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_therapist public.therapists;
  v_reason text;
begin
  perform private.require_staff(array['owner']::public.staff_role[]);
  v_reason := private.require_reason(p_reason); -- [5e] only after the role check
  select * into v_therapist from public.therapists t where t.id = p_therapist_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_current(v_therapist.updated_at, p_expected_updated_at);
  if p_profile_id is not null and not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_profile_id is not distinct from v_therapist.profile_id then
    return v_therapist;
  end if;
  perform private.audit_label(case when p_profile_id is null then 'staff.therapist_unlinked' else 'staff.therapist_linked' end, v_reason);
  update public.therapists set profile_id = p_profile_id where id = p_therapist_id returning * into v_therapist;
  perform private.audit_clear();
  return v_therapist;
end;
$$;

-- staff_update_booking_rules (from 20261010000100_staff_security_foundation.sql)
create or replace function public.staff_update_booking_rules(
  p_expected_updated_at timestamptz,
  p_reason text,
  p_business_name text default null,
  p_hold_minutes integer default null,
  p_min_lead_minutes integer default null,
  p_max_advance_days integer default null,
  p_slot_interval_minutes integer default null,
  p_default_buffer_minutes integer default null
)
returns public.business_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.business_settings;
  v_reason text;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  v_reason := private.require_reason(p_reason); -- [5e] only after the role check
  select * into v_settings from public.business_settings for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_current(v_settings.updated_at, p_expected_updated_at);
  perform private.audit_label('settings.booking_rules_changed', v_reason);
  update public.business_settings
     set business_name = coalesce(nullif(trim(p_business_name), ''), business_name),
         hold_minutes = coalesce(p_hold_minutes, hold_minutes),
         min_lead_minutes = coalesce(p_min_lead_minutes, min_lead_minutes),
         max_advance_days = coalesce(p_max_advance_days, max_advance_days),
         slot_interval_minutes = coalesce(p_slot_interval_minutes, slot_interval_minutes),
         default_buffer_minutes = coalesce(p_default_buffer_minutes, default_buffer_minutes)
  returning * into v_settings;
  perform private.audit_clear();
  return v_settings;
end;
$$;

-- owner_update_payment_settings (from 20261010000100_staff_security_foundation.sql)
create or replace function public.owner_update_payment_settings(
  p_expected_updated_at timestamptz,
  p_reason text,
  p_online_payment_enabled boolean default null,
  p_payment_mode public.payment_kind default null,
  p_deposit_percent integer default null
)
returns public.business_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.business_settings;
  v_reason text;
begin
  perform private.require_staff(array['owner']::public.staff_role[]);
  v_reason := private.require_reason(p_reason); -- [5e] only after the role check
  select * into v_settings from public.business_settings for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_current(v_settings.updated_at, p_expected_updated_at);
  perform private.audit_label('settings.payment_settings_changed', v_reason);
  update public.business_settings
     set online_payment_enabled = coalesce(p_online_payment_enabled, online_payment_enabled),
         payment_mode = coalesce(p_payment_mode, payment_mode),
         deposit_percent = coalesce(p_deposit_percent, deposit_percent)
  returning * into v_settings;
  perform private.audit_clear();
  return v_settings;
end;
$$;

-- staff_create_booking (from 20261011000100_staff_appointment_operations.sql)
create or replace function public.staff_create_booking(
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
  v_reason text;
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
  v_reason := private.require_reason(p_reason); -- [5e] only after the role check

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

-- staff_reschedule_appointment (from 20261011000100_staff_appointment_operations.sql)
create or replace function public.staff_reschedule_appointment(
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
  v_reason text;
  v_appt public.appointments;
  v_current_therapist uuid;
  v_therapist uuid;
  v_ends_at timestamptz;
  v_blocked_until timestamptz;
  v_rule text;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  v_reason := private.require_reason(p_reason); -- [5e] only after the role check
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

-- staff_cancel_appointment (from 20261011000100_staff_appointment_operations.sql)
create or replace function public.staff_cancel_appointment(
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
  v_reason text;
  v_appt public.appointments;
  v_flagged uuid[];
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  v_reason := private.require_reason(p_reason); -- [5e] only after the role check
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

-- staff_set_settlement (from 20261011000100_staff_appointment_operations.sql)
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
  v_reason := private.require_reason(p_reason); -- [5e] only after the role check
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

-- owner_record_refund (from 20261013000100_staff_payments_staff_audit.sql)
create or replace function public.owner_record_refund(
  p_payment_id uuid,
  p_amount_minor bigint,
  p_method public.refund_method,
  p_reason text,
  p_expected_updated_at timestamptz,
  p_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_reference text := nullif(trim(coalesce(p_reference, '')), '');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_payment public.payments;
  v_refunded bigint;
begin
  perform private.require_staff(array['owner']::public.staff_role[]);
  v_reason := private.require_reason(p_reason); -- [5e] only after the role check
  select * into v_payment from public.payments p where p.id = p_payment_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_current(v_payment.updated_at, p_expected_updated_at);
  if v_payment.paid_minor is null or v_payment.status not in ('succeeded', 'partially_refunded') then
    raise exception 'not_refundable' using errcode = 'P0001';
  end if;
  if p_method is null or length(v_reference) > 120 or length(v_note) > 500 then
    raise exception 'invalid_refund' using errcode = 'P0001';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor > v_payment.refundable_minor then
    raise exception 'exceeds_refundable' using errcode = 'P0001';
  end if;

  perform private.audit_label('payment.refund_recorded', v_reason,
    jsonb_build_object('payment_id', v_payment.id, 'method', p_method, 'amount_minor', p_amount_minor));
  insert into public.refund_records (payment_id, amount_minor, currency, method, reference, note, recorded_by, is_demo)
  values (v_payment.id, p_amount_minor, coalesce(v_payment.paid_currency, v_payment.currency), p_method, v_reference, v_note,
          (select auth.uid()), v_payment.is_demo);

  if p_method = 'provider_dashboard' then
    -- Intent only: amounts change when the provider reports the refund.
    update public.payments
       set refund_status = case when refund_status in ('none', 'failed', 'needs_attention') then 'pending'::public.refund_status else refund_status end,
           refund_requested_at = coalesce(refund_requested_at, clock_timestamp()),
           refund_reference = coalesce(v_reference, refund_reference),
           refund_reason = coalesce(refund_reason, v_reason)
     where id = v_payment.id
    returning * into v_payment;
  else
    v_refunded := v_payment.refunded_minor + p_amount_minor;
    update public.payments
       set refunded_minor = v_refunded,
           status = case when v_refunded >= paid_minor then 'refunded' else 'partially_refunded' end::public.payment_status,
           needs_refund = case when v_refunded >= paid_minor then false else needs_refund end,
           refund_status = 'processed',
           refund_reference = coalesce(v_reference, refund_reference),
           refund_reason = coalesce(refund_reason, v_reason),
           refund_requested_at = coalesce(refund_requested_at, clock_timestamp()),
           refund_processed_at = clock_timestamp(),
           refund_error = null
     where id = v_payment.id
    returning * into v_payment;
  end if;
  perform private.audit_clear();

  return jsonb_build_object(
    'payment_id', v_payment.id, 'status', v_payment.status, 'refunded_minor', v_payment.refunded_minor,
    'refundable_minor', v_payment.refundable_minor, 'refund_status', v_payment.refund_status,
    'needs_refund', v_payment.needs_refund, 'updated_at', v_payment.updated_at
  );
end;
$$;
