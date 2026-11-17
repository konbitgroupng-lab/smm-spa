-- Undoes 20261019000200_bank_transfer.sql (guest bookings paid by bank transfer).
--
-- Run only as part of a planned rollback (docs/LAUNCH-RUNBOOK.md,
-- "Undoing"), in one transaction, before any older rollback script. It
-- refuses to run while any booking is settled by bank transfer: cancel or
-- rebook those first (their guests must be told). The enum value
-- 'bank_transfer' added by 20261019000100 stays: PostgreSQL cannot remove an
-- enum value, it is harmless unused, and re-applying the migration skips it.

do $$
begin
  if exists (select 1 from public.appointments where settlement = 'bank_transfer') then
    raise exception 'Bookings paid by bank transfer exist. Cancel or rebook them before rolling back.';
  end if;
end;
$$;

drop function public.owner_update_transfer_settings(timestamptz, text, boolean, text, text, text);
drop function public.staff_confirm_transfer(uuid, timestamptz, text);
drop function public.staff_transfers();
drop function public.get_transfer_booking(uuid);
drop function public.request_transfer_booking(uuid, text, text);
drop function private.transfer_view(public.appointments, public.business_settings, bigint);

-- The previous versions of the functions the migration replaced.
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
      'deposit_percent', bs.deposit_percent, 'allow_demo_payments', bs.allow_demo_payments, 'updated_at', bs.updated_at
    )
    from public.business_settings bs
  );
end;
$$;

delete from private.audit_personal_columns where entity_type = 'appointments' and column_name = 'transfer_token';

alter table public.appointments
  drop constraint appointments_source_settlement,
  add constraint appointments_source_settlement check ((source = 'online') = (settlement = 'online_payment'));
alter table public.appointments
  drop constraint appointments_transfer_fields,
  drop column transfer_received_by,
  drop column transfer_received_at,
  drop column transfer_due_at,
  drop column transfer_amount_minor,
  drop column transfer_token;

alter table public.business_settings
  drop constraint business_settings_transfer_account,
  drop column transfer_max_unpaid,
  drop column transfer_hold_minutes,
  drop column bank_account_name,
  drop column bank_account_number,
  drop column bank_name,
  drop column transfer_enabled;
