-- Phase 5d: payment visibility, manual refund recording, staff management
-- and the audit viewer.
--
--   1. Payments are now audited like other tables, so each payment has a
--      history of its status and refund changes (written by the server).
--   2. refund_records: an append-only record of refunds made outside the
--      system, entered by the owner only (Decision D). "Via provider
--      dashboard" records intent only and never changes amounts (the
--      provider's refund event stays the source of truth); bank transfer and
--      cash update the payment's refunded amount, capped at what was paid.
--      No refund is ever initiated here.
--   3. Read functions for payments, the refund queue, the audit log, staff
--      accounts and settings; an owner-only function that records invitations
--      sent by the staff-invite Edge Function.
--
-- Staff still cannot write payments, payment events or refund records
-- directly. Lock order is unchanged: ... -> appointments row -> payments row.

-- =========================================================================
-- 1. Payment history
-- =========================================================================
-- The checkout address can act as a link to pay: recorded only as changed.
insert into private.audit_personal_columns (entity_type, column_name) values ('payments', 'checkout_url');

create trigger audit_row_change after insert or update or delete on public.payments
  for each row execute function private.audit_row_change('id');

-- =========================================================================
-- 2. Manual refund records
-- =========================================================================
create type public.refund_method as enum ('provider_dashboard', 'bank_transfer', 'cash');

create table public.refund_records (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  method public.refund_method not null,
  reference text check (reference is null or length(reference) <= 120),
  note text check (note is null or length(note) <= 500),
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  recorded_at timestamptz not null default now(),
  is_demo boolean not null default false
);
create index refund_records_payment_idx on public.refund_records (payment_id, recorded_at);

alter table public.refund_records enable row level security;
revoke all on public.refund_records from public, anon, authenticated, service_role;
grant select on public.refund_records to authenticated, service_role;
create policy "admin read" on public.refund_records for select to authenticated using ((select private.is_admin()));

-- Nobody edits or deletes a refund record, whoever they are.
create function private.refund_records_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'refund_records_are_append_only' using errcode = '42501';
end;
$$;
create trigger refund_records_append_only before update or delete on public.refund_records
  for each row execute function private.refund_records_append_only();
create trigger refund_records_no_truncate before truncate on public.refund_records
  for each statement execute function private.refund_records_append_only();

create trigger audit_row_change after insert or update or delete on public.refund_records
  for each row execute function private.audit_row_change('id');
insert into private.audit_personal_columns (entity_type, column_name) values ('refund_records', 'note');

-- Owner: record a refund made outside the system.
create function public.owner_record_refund(
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
  v_reason text := private.require_reason(p_reason);
  v_reference text := nullif(trim(coalesce(p_reference, '')), '');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_payment public.payments;
  v_refunded bigint;
begin
  perform private.require_staff(array['owner']::public.staff_role[]);
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

-- =========================================================================
-- 3. Reads (owner/admin)
-- =========================================================================

-- The payments list. p_filter: all | succeeded | pending | failed | abandoned
-- | refund_due (flagged and not yet fully refunded) | refunded.
create function public.staff_payments(
  p_filter text default 'all',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  payment_id uuid,
  provider text,
  reference text,
  kind public.payment_kind,
  status public.payment_status,
  amount_minor bigint,
  paid_minor bigint,
  refunded_minor bigint,
  refundable_minor bigint,
  currency text,
  created_at timestamptz,
  paid_at timestamptz,
  needs_refund boolean,
  needs_refund_reason text,
  needs_refund_detail text,
  refund_status public.refund_status,
  is_demo boolean,
  is_test boolean,
  appointment_id uuid,
  appointment_reference text,
  starts_at timestamptz,
  service_name text,
  guest_name text,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  if p_filter is null or p_filter not in ('all', 'succeeded', 'pending', 'failed', 'abandoned', 'refund_due', 'refunded')
     or p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0 then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;
  return query
  select p.id, p.provider, p.provider_reference, p.kind, p.status, p.amount_minor, p.paid_minor, p.refunded_minor,
         p.refundable_minor, p.currency::text, p.created_at, p.paid_at, p.needs_refund, p.needs_refund_reason,
         p.needs_refund_detail, p.refund_status, p.is_demo, p.is_test, a.id, a.reference,
         coalesce(a.starts_at, h.starts_at), s.name, coalesce(a.contact_name, h.contact_name, c.full_name),
         p.updated_at, count(*) over ()
  from public.payments p
  left join public.appointments a on a.id = p.appointment_id
  left join public.booking_holds h on h.id = p.hold_id
  left join public.services s on s.id = coalesce(a.service_id, h.service_id)
  left join public.customers c on c.id = coalesce(a.customer_id, h.customer_id)
  where case p_filter
    when 'all' then true
    when 'succeeded' then p.status = 'succeeded'
    when 'pending' then p.status in ('initialized', 'pending')
    when 'failed' then p.status = 'failed'
    when 'abandoned' then p.status = 'abandoned'
    when 'refund_due' then p.needs_refund and p.refundable_minor > 0
    when 'refunded' then p.status in ('refunded', 'partially_refunded')
  end
  order by case when p_filter = 'refund_due' then p.created_at end asc, p.created_at desc, p.id
  limit p_limit offset p_offset;
end;
$$;

-- One payment: the booking or reservation it belongs to, the guest, refund
-- records, provider events received (type and timing only, never payloads),
-- and its history. Never the checkout address.
create function public.staff_payment_detail(p_payment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_hold public.booking_holds;
  v_appt public.appointments;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  select * into v_payment from public.payments p where p.id = p_payment_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_hold from public.booking_holds h where h.id = v_payment.hold_id;
  select * into v_appt from public.appointments a where a.id = v_payment.appointment_id;

  return jsonb_build_object(
    'payment', jsonb_build_object(
      'id', v_payment.id, 'provider', v_payment.provider, 'reference', v_payment.provider_reference, 'kind', v_payment.kind,
      'status', v_payment.status, 'amount_minor', v_payment.amount_minor, 'booking_total_minor', v_payment.booking_total_minor,
      'paid_minor', v_payment.paid_minor, 'paid_currency', v_payment.paid_currency, 'refunded_minor', v_payment.refunded_minor,
      'refundable_minor', v_payment.refundable_minor, 'currency', v_payment.currency, 'is_test', v_payment.is_test,
      'is_demo', v_payment.is_demo, 'created_at', v_payment.created_at, 'paid_at', v_payment.paid_at,
      'verified_at', v_payment.verified_at, 'channel', v_payment.channel, 'failure_reason', v_payment.failure_reason,
      'needs_refund', v_payment.needs_refund, 'needs_refund_reason', v_payment.needs_refund_reason,
      'needs_refund_detail', v_payment.needs_refund_detail, 'refund_status', v_payment.refund_status,
      'refund_reference', v_payment.refund_reference, 'refund_requested_at', v_payment.refund_requested_at,
      'refund_processed_at', v_payment.refund_processed_at, 'refund_error', v_payment.refund_error,
      'updated_at', v_payment.updated_at
    ),
    'booking', case when v_appt.id is not null then jsonb_build_object(
      'appointment_id', v_appt.id, 'reference', v_appt.reference, 'status', v_appt.status, 'starts_at', v_appt.starts_at,
      'service_name', (select s.name from public.services s where s.id = v_appt.service_id),
      'therapist_name', (select t.display_name from public.therapists t where t.id = v_appt.therapist_id)
    ) end,
    'reservation', case when v_hold.id is not null then jsonb_build_object(
      'status', v_hold.status, 'starts_at', v_hold.starts_at, 'expires_at', v_hold.expires_at,
      'service_name', (select s.name from public.services s where s.id = v_hold.service_id),
      'therapist_name', (select t.display_name from public.therapists t where t.id = v_hold.therapist_id)
    ) end,
    'guest', (
      select jsonb_build_object('customer_id', c.id, 'full_name', c.full_name, 'email', c.email, 'phone', c.phone,
        'contact_name', coalesce(v_appt.contact_name, v_hold.contact_name))
      from public.customers c where c.id = coalesce(v_appt.customer_id, v_hold.customer_id)
    ),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'amount_minor', r.amount_minor, 'currency', r.currency, 'method', r.method,
        'reference', r.reference, 'note', r.note, 'recorded_at', r.recorded_at, 'is_demo', r.is_demo,
        'recorded_by_name', (select p.full_name from public.profiles p where p.id = r.recorded_by)) order by r.recorded_at)
      from public.refund_records r where r.payment_id = v_payment.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('event_type', e.event_type, 'received_at', e.received_at,
        'processed_at', e.processed_at, 'processing_error', e.processing_error) order by e.received_at)
      from public.payment_events e where e.payment_id = v_payment.id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'occurred_at', l.occurred_at, 'action', l.action, 'actor_kind', l.actor_kind,
        'actor_name', (select p.full_name from public.profiles p where p.id = l.actor_id),
        'actor_role', l.actor_role, 'changes', l.changes, 'reason', l.reason, 'context', l.context
      ) order by l.id)
      from public.audit_log l where l.entity_type = 'payments' and l.entity_id = v_payment.id::text
    ), '[]'::jsonb)
  );
end;
$$;

-- The audit log, newest first, with the actor's name. Filters are optional;
-- p_before_id pages backwards. Entries cannot be changed by anyone.
create function public.staff_audit_log(
  p_entity_types text[] default null,
  p_entity_id text default null,
  p_action_prefix text default null,
  p_before_id bigint default null,
  p_limit integer default 50
)
returns table (
  id bigint,
  occurred_at timestamptz,
  actor_kind text,
  actor_name text,
  actor_role public.staff_role,
  action text,
  entity_type text,
  entity_id text,
  changes jsonb,
  reason text,
  context jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  if p_limit is null or p_limit not between 1 and 200 or length(p_action_prefix) > 60 or length(p_entity_id) > 200 then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;
  return query
  select l.id, l.occurred_at, l.actor_kind, (select p.full_name from public.profiles p where p.id = l.actor_id),
         l.actor_role, l.action, l.entity_type, l.entity_id, l.changes, l.reason, l.context
  from public.audit_log l
  where (p_entity_types is null or l.entity_type = any (p_entity_types))
    and (p_entity_id is null or l.entity_id = p_entity_id)
    and (p_action_prefix is null or left(l.action, length(p_action_prefix)) = p_action_prefix)
    and (p_before_id is null or l.id < p_before_id)
  order by l.id desc
  limit p_limit;
end;
$$;

-- Settings for the staff app. allow_demo_payments is shown, never changed.
create function public.staff_settings()
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

-- =========================================================================
-- 4. Staff accounts (owner only)
-- =========================================================================
create function public.owner_staff_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner']::public.staff_role[]);
  return jsonb_build_object(
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'email', u.email, 'full_name', p.full_name, 'phone', p.phone, 'role', p.role,
        'is_active', p.is_active, 'created_at', p.created_at, 'updated_at', p.updated_at,
        'therapist', (select jsonb_build_object('id', t.id, 'name', t.display_name) from public.therapists t where t.profile_id = p.id)
      ) order by p.is_active desc, p.role, lower(coalesce(nullif(p.full_name, ''), u.email)))
      from public.profiles p join auth.users u on u.id = p.id
    ), '[]'::jsonb),
    'therapists', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name, 'profile_id', t.profile_id,
        'is_active', t.is_active, 'updated_at', t.updated_at) order by t.sort_order, t.display_name)
      from public.therapists t
    ), '[]'::jsonb)
  );
end;
$$;

-- Called by the staff-invite Edge Function, as the inviting owner, once Supabase
-- Auth has sent the invitation. The new account already exists (inactive, no
-- staff access); this records who invited it. No email is copied to the log.
create function public.owner_record_invitation(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner']::public.staff_role[]);
  if not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.audit_note('staff.invited', 'profiles', p_profile_id::text, null, '{}'::jsonb);
end;
$$;

-- =========================================================================
-- 5. Dashboard: payments waiting on the provider for a while
-- =========================================================================
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
      'schedule_conflicts', (select count(distinct c.appointment_id) from private.appointment_conflicts() c),
      -- The provider reported "pending" more than 10 minutes ago and nothing since.
      'payments_waiting', (
        select count(*) from public.payments p where p.status = 'pending' and p.updated_at < clock_timestamp() - interval '10 minutes'
      )
    )
    from public.appointments a
    where a.starts_at >= v_from and a.starts_at < v_to
  );
end;
$$;

-- =========================================================================
-- Privileges
-- =========================================================================
revoke execute on function private.refund_records_append_only() from public;

revoke execute on function
  public.owner_record_refund(uuid, bigint, public.refund_method, text, timestamptz, text, text),
  public.staff_payments(text, integer, integer),
  public.staff_payment_detail(uuid),
  public.staff_audit_log(text[], text, text, bigint, integer),
  public.staff_settings(),
  public.owner_staff_list(),
  public.owner_record_invitation(uuid)
from public, anon;

grant execute on function
  public.owner_record_refund(uuid, bigint, public.refund_method, text, timestamptz, text, text),
  public.staff_payments(text, integer, integer),
  public.staff_payment_detail(uuid),
  public.staff_audit_log(text[], text, text, bigint, integer),
  public.staff_settings(),
  public.owner_staff_list(),
  public.owner_record_invitation(uuid)
to authenticated;
