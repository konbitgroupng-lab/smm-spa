-- Phase 5a: staff security foundation.
--
--   1. One place decides who a caller is (private.staff_role), ready for MFA.
--   2. Role hardening: staff can no longer write appointments, profiles or
--      business settings directly, delete customers, or link therapist records
--      to accounts. Those changes go through checked, audited functions.
--   3. An append-only audit log, written by triggers whatever the path.
--   4. The first staff functions: identity, staff roles and activation,
--      therapist links, own profile, booking rules, payment settings, and the
--      therapist's agenda.
--
-- Guest (anon) access is not changed by anything here.

-- =========================================================================
-- 1. Who is calling
-- =========================================================================

-- Session strength each role must present. Everything is 'aal1' (password)
-- for now; requiring two-factor authentication for a role later is a single
-- update here, e.g. set required_aal = 'aal2' where role = 'owner'.
create table private.auth_policy (
  role public.staff_role primary key,
  required_aal text not null default 'aal1' check (required_aal in ('aal1', 'aal2'))
);
insert into private.auth_policy (role) values ('owner'), ('admin'), ('therapist');
alter table private.auth_policy enable row level security;
revoke all on private.auth_policy from public, anon, authenticated;

-- Authentication assurance level of the current session (Supabase puts it in the JWT).
create function private.session_aal()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif((select auth.jwt()) ->> 'aal', ''), 'aal1');
$$;

-- Role of the calling user, or null for guests, inactive staff, and sessions
-- weaker than their role requires. Every RLS policy and staff function relies
-- on this, so a later MFA requirement applies everywhere at once.
create or replace function private.staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  join private.auth_policy ap on ap.role = p.role
  where p.id = (select auth.uid())
    and p.is_active
    and (ap.required_aal = 'aal1' or private.session_aal() = 'aal2');
$$;

-- Therapist record linked to the calling user, under the same conditions.
create or replace function private.therapist_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.therapists t
  where t.profile_id = (select auth.uid()) and private.staff_role() is not null;
$$;

create function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.staff_role() = 'owner', false);
$$;

-- Refuses the call unless the caller has one of the given roles.
create function private.require_staff(p_roles public.staff_role[])
returns public.staff_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.staff_role := private.staff_role();
begin
  if v_role is null or not (v_role = any (p_roles)) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

-- Named staff actions record a reason; it must say something.
create function private.require_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  return left(trim(p_reason), 500);
end;
$$;

-- Edits carry the version the screen was showing; a newer one is not overwritten.
create function private.require_current(p_actual timestamptz, p_expected timestamptz)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_expected is null or p_actual is distinct from p_expected then
    raise exception 'stale_record' using errcode = 'P0001';
  end if;
end;
$$;

-- =========================================================================
-- 2. Role hardening (decision B)
-- =========================================================================

-- Profiles: read by owner/admin (and each user their own); changed only by
-- the functions below.
drop policy "admin manage" on public.profiles;
create policy "admin read" on public.profiles for select to authenticated
  using ((select private.is_admin()));
revoke insert, update, delete on public.profiles from authenticated;

-- Appointments: read by owner/admin and the assigned therapist; changed only
-- by server-side functions (staff actions arrive in later Phase 5 checkpoints).
drop policy "admin manage" on public.appointments;
create policy "admin read" on public.appointments for select to authenticated
  using ((select private.is_admin()));
revoke insert, update, delete on public.appointments from authenticated;

-- Business settings: readable by everyone as before; changed only by functions.
-- allow_demo_payments has no function at all: it cannot be changed from the app.
drop policy "admin update" on public.business_settings;
revoke update on public.business_settings from authenticated;

-- Customers: never deleted from the app (bookings and payments refer to them);
-- therapists no longer read the table, they get booking contact details
-- through therapist_agenda().
revoke delete on public.customers from authenticated;
drop policy "therapist read own customers" on public.customers;

-- Therapists: owner/admin still manage the catalogue fields, but which login
-- account a therapist record belongs to (which grants that account the
-- therapist's agenda) is set only by the owner, through owner_link_therapist().
revoke insert, update on public.therapists from authenticated;
grant insert (display_name, title, specialty, bio, photo_url, photo_media_id, is_active, sort_order, is_demo)
  on public.therapists to authenticated;
grant update (display_name, title, specialty, bio, photo_url, photo_media_id, is_active, sort_order, is_demo)
  on public.therapists to authenticated;

-- Services, therapists and dispatch zones are deactivated, never deleted
-- (decision H): bookings, payments and the audit log refer to them.
revoke delete on public.services, public.therapists, public.dispatch_zones from authenticated;

-- There is always at least one active owner. Serialised so two owners
-- demoting each other at the same moment cannot both succeed.
create function private.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'DELETE' and old.role = 'owner' and old.is_active)
     or (tg_op = 'UPDATE' and old.role = 'owner' and old.is_active and (new.role <> 'owner' or not new.is_active)) then
    perform pg_advisory_xact_lock(hashtextextended('smm.owners', 0));
    if not exists (
      select 1 from public.profiles p where p.role = 'owner' and p.is_active and p.id <> old.id
    ) then
      raise exception 'last_owner' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger protect_last_owner
  before update of role, is_active or delete on public.profiles
  for each row execute function private.protect_last_owner();

-- =========================================================================
-- 3. Audit log (decision P)
-- =========================================================================
-- Append-only. Written by triggers (every change to the tables listed below,
-- by staff, guests or server processes) and enriched by staff functions with
-- the named action and the reason given. Personal data is never copied: for
-- those columns the log records only that they changed. Inserts record that
-- the row was created (its values are in the table, and later changes are
-- logged); deletes keep the non-personal values of the removed row.

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  -- Signed-in user who caused the change; null for guests and server processes.
  actor_id uuid,
  actor_role public.staff_role,
  actor_kind text not null check (actor_kind in ('staff', 'system')),
  -- insert | update | delete, or a named staff action such as staff.role_changed
  action text not null,
  entity_type text not null,
  entity_id text,
  -- {column: {"old": .., "new": ..}}, or {column: {"changed": true}} for personal data
  changes jsonb not null default '{}'::jsonb,
  reason text,
  context jsonb not null default '{}'::jsonb,
  -- For a future retention/redaction policy.
  retention_class text not null default 'standard',
  redacted_at timestamptz
);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, occurred_at desc);
create index audit_log_time_idx on public.audit_log (occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, occurred_at desc) where actor_id is not null;

alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated, service_role;
grant select on public.audit_log to authenticated, service_role;
create policy "admin read" on public.audit_log for select to authenticated using ((select private.is_admin()));

-- Nobody edits or deletes audit entries. A future redaction policy will go
-- through a dedicated function that sets smm.audit_redaction for its own
-- transaction; nothing else can.
create function private.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and current_setting('smm.audit_redaction', true) = 'on' then
    return new;
  end if;
  raise exception 'audit_log_is_append_only' using errcode = '42501';
end;
$$;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function private.audit_log_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_log_append_only();

-- Columns holding personal data: changes are recorded without their values.
create table private.audit_personal_columns (
  entity_type text not null,
  column_name text not null,
  primary key (entity_type, column_name)
);
insert into private.audit_personal_columns (entity_type, column_name) values
  ('customers', 'full_name'), ('customers', 'email'), ('customers', 'phone'), ('customers', 'staff_notes'),
  ('appointments', 'contact_name'), ('appointments', 'contact_phone'),
  ('appointments', 'service_address'), ('appointments', 'customer_notes'),
  ('profiles', 'full_name'), ('profiles', 'phone');
alter table private.audit_personal_columns enable row level security;
revoke all on private.audit_personal_columns from public, anon, authenticated;

-- Row-change trigger. TG_ARGV holds the key column(s) that identify the row.
create function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_personal text[];
  v_key text;
  v_actor uuid := auth.uid();
  v_action text;
begin
  if tg_op <> 'INSERT' then
    select coalesce(array_agg(c.column_name), '{}') into v_personal
    from private.audit_personal_columns c where c.entity_type = tg_table_name;

    for v_key in select jsonb_object_keys(v_row) loop
      continue when v_key in ('updated_at', 'created_at');
      if tg_op = 'UPDATE' then
        continue when (v_old -> v_key) is not distinct from (v_new -> v_key);
        v_changes := v_changes || jsonb_build_object(v_key,
          case when v_key = any (v_personal) then jsonb_build_object('changed', true)
               else jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key) end);
      elsif v_key <> all (v_personal) then -- DELETE: keep non-personal values of the removed row
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key));
      end if;
    end loop;

    if tg_op = 'UPDATE' and v_changes = '{}'::jsonb then
      return null; -- nothing that matters changed
    end if;
  end if;

  v_action := coalesce(nullif(current_setting('smm.audit_action', true), ''), lower(tg_op));

  insert into public.audit_log (actor_id, actor_role, actor_kind, action, entity_type, entity_id, changes, reason, context)
  values (
    v_actor,
    (select p.role from public.profiles p where p.id = v_actor),
    case when v_actor is null then 'system' else 'staff' end,
    v_action,
    tg_table_name,
    (select string_agg(v_row ->> k, ':') from unnest(tg_argv) as k),
    v_changes,
    nullif(current_setting('smm.audit_reason', true), ''),
    coalesce(nullif(current_setting('smm.audit_context', true), '')::jsonb, '{}'::jsonb)
  );
  return null;
end;
$$;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('profiles', 'id'), ('therapists', 'id'), ('therapist_services', 'therapist_id, service_id'),
      ('therapist_schedules', 'id'), ('therapist_breaks', 'id'), ('therapist_time_off', 'id'),
      ('blackout_dates', 'id'), ('business_hours', 'day_of_week'), ('business_settings', 'id'),
      ('services', 'id'), ('service_package_items', 'package_id, service_id'), ('dispatch_zones', 'id'),
      ('customers', 'id'), ('appointments', 'id')
    ) as v (tbl, keys)
  loop
    execute format(
      'create trigger audit_row_change after insert or update or delete on public.%I
         for each row execute function private.audit_row_change(%s)',
      t.tbl,
      (select string_agg(quote_literal(trim(k)), ', ') from unnest(string_to_array(t.keys, ',')) as k)
    );
  end loop;
end;
$$;

-- Lets a staff function label the changes it is about to make.
-- Labels apply to the current transaction only and are cleared right after the
-- labelled change, so they can never attach to anything else.
create function private.audit_label(p_action text, p_reason text default null, p_context jsonb default '{}'::jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('smm.audit_action', coalesce(p_action, ''), true);
  perform set_config('smm.audit_reason', coalesce(p_reason, ''), true);
  perform set_config('smm.audit_context', coalesce(p_context, '{}'::jsonb)::text, true);
end;
$$;

create function private.audit_clear()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.audit_label('', null, '{}'::jsonb);
end;
$$;

-- =========================================================================
-- 4. Staff functions
-- =========================================================================

-- Who the signed-in user is, for the staff app. Reports an account that is
-- inactive, has no role yet, or needs a stronger session, without granting anything.
create function public.staff_whoami()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', (select auth.uid()),
    'profile', (
      select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'role', p.role,
                                'is_active', p.is_active, 'updated_at', p.updated_at)
      from public.profiles p where p.id = (select auth.uid())
    ),
    'effective_role', private.staff_role(),
    'therapist_id', private.therapist_id(),
    'session_aal', private.session_aal(),
    'required_aal', (
      select ap.required_aal from public.profiles p join private.auth_policy ap on ap.role = p.role
      where p.id = (select auth.uid())
    )
  );
$$;

-- Owner: change a staff member's role.
create function public.owner_set_staff_role(
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
  v_reason text := private.require_reason(p_reason);
begin
  perform private.require_staff(array['owner']::public.staff_role[]);
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

-- Owner: activate or deactivate a staff account. Takes effect on the next request.
create function public.owner_set_staff_active(
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
  v_reason text := private.require_reason(p_reason);
begin
  perform private.require_staff(array['owner']::public.staff_role[]);
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

-- Owner: link a therapist record to a staff account (or unlink with null).
create function public.owner_link_therapist(
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
  v_reason text := private.require_reason(p_reason);
begin
  perform private.require_staff(array['owner']::public.staff_role[]);
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

-- Any active staff member: their own name and phone (never role or status).
create function public.staff_update_own_profile(p_full_name text, p_phone text, p_expected_updated_at timestamptz)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_name text := trim(coalesce(p_full_name, ''));
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
begin
  perform private.require_staff(array['owner', 'admin', 'therapist']::public.staff_role[]);
  if length(v_name) < 2 or length(v_name) > 120 or (v_phone is not null and v_phone !~ '^\+?[0-9][0-9 ()-]{6,19}$') then
    raise exception 'invalid_profile' using errcode = 'P0001';
  end if;
  select * into v_profile from public.profiles p where p.id = (select auth.uid()) for update;
  perform private.require_current(v_profile.updated_at, p_expected_updated_at);
  perform private.audit_label('staff.profile_updated');
  update public.profiles set full_name = v_name, phone = v_phone where id = v_profile.id returning * into v_profile;
  perform private.audit_clear();
  return v_profile;
end;
$$;

-- Owner/admin: booking rules. Null leaves a value unchanged. Timezone and
-- currency are not editable here; payment settings have their own function.
create function public.staff_update_booking_rules(
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
  v_reason text := private.require_reason(p_reason);
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
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

-- Owner: online payment settings. allow_demo_payments is deliberately absent.
create function public.owner_update_payment_settings(
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
  v_reason text := private.require_reason(p_reason);
begin
  perform private.require_staff(array['owner']::public.staff_role[]);
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

-- The signed-in therapist's own appointments, with only the details needed to
-- treat the guest: the contact name and phone given for the booking (falling
-- back to the customer's), the address for in-home visits and the guest's
-- notes. No email, no staff notes, no payment amounts.
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
  payment_state text,
  is_demo boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_therapist uuid := private.therapist_id();
begin
  if v_therapist is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;

  return query
  select a.id, a.reference, a.starts_at, a.ends_at, a.status, s.name, s.duration_minutes,
         a.location_type, z.name, a.service_address,
         coalesce(a.contact_name, c.full_name), coalesce(a.contact_phone, c.phone), a.customer_notes,
         case when exists (
           select 1 from public.payments p
           where p.appointment_id = a.id and p.status in ('succeeded', 'partially_refunded')
         ) then 'paid' else 'to_collect' end,
         a.is_demo
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
  private.session_aal(), private.require_staff(public.staff_role[]), private.require_reason(text),
  private.require_current(timestamptz, timestamptz), private.protect_last_owner(),
  private.audit_log_append_only(), private.audit_row_change(), private.audit_label(text, text, jsonb), private.audit_clear()
from public;

-- The role helpers serve signed-in policies and functions only. Guests never
-- reach them: no policy that applies to anon uses them, and anon loses the
-- private schema altogether.
revoke execute on function private.staff_role(), private.is_admin(), private.therapist_id(), private.is_owner()
  from public, anon;
grant execute on function private.staff_role(), private.is_admin(), private.therapist_id(), private.is_owner()
  to authenticated, service_role;
revoke usage on schema private from anon;

revoke execute on function
  public.staff_whoami(),
  public.owner_set_staff_role(uuid, public.staff_role, text, timestamptz),
  public.owner_set_staff_active(uuid, boolean, text, timestamptz),
  public.owner_link_therapist(uuid, uuid, text, timestamptz),
  public.staff_update_own_profile(text, text, timestamptz),
  public.staff_update_booking_rules(timestamptz, text, text, integer, integer, integer, integer, integer),
  public.owner_update_payment_settings(timestamptz, text, boolean, public.payment_kind, integer),
  public.therapist_agenda(timestamptz, timestamptz)
from public, anon;

grant execute on function
  public.staff_whoami(),
  public.owner_set_staff_role(uuid, public.staff_role, text, timestamptz),
  public.owner_set_staff_active(uuid, boolean, text, timestamptz),
  public.owner_link_therapist(uuid, uuid, text, timestamptz),
  public.staff_update_own_profile(text, text, timestamptz),
  public.staff_update_booking_rules(timestamptz, text, text, integer, integer, integer, integer, integer),
  public.owner_update_payment_settings(timestamptz, text, boolean, public.payment_kind, integer),
  public.therapist_agenda(timestamptz, timestamptz)
to authenticated;
