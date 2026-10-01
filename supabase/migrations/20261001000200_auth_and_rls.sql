-- Phase 1: Supabase Auth integration, grants and Row Level Security.
-- Authorization is enforced here, never only in the frontend.
--
-- Roles:
--   anon           website visitors (guests)
--   authenticated  signed-in staff; what they can do depends on profiles.role
--   service_role   Edge Functions only (bypasses RLS); never shipped to the browser

-- ---------------------------------------------------------------------------
-- Auth helpers
-- ---------------------------------------------------------------------------
-- Every Auth user gets a profile. It starts inactive as a therapist, so a new
-- account can do nothing until an owner/admin activates it. The role is never
-- read from user-supplied sign-up metadata.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Role of the calling user, or null for guests and inactive staff.
create function private.staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid()) and p.is_active;
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.staff_role() in ('owner', 'admin'), false);
$$;

-- Therapist record linked to the calling user, or null.
create function private.therapist_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.therapists t
  join public.profiles p on p.id = t.profile_id
  where t.profile_id = (select auth.uid()) and p.is_active;
$$;

revoke execute on function private.handle_new_user() from public;
grant usage on schema private to anon, authenticated, service_role;
grant execute on function private.staff_role(), private.is_admin(), private.therapist_id()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grants (RLS below narrows these further)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

-- Public website content.
grant select on
  public.business_settings, public.business_hours, public.dispatch_zones,
  public.services, public.service_package_items, public.therapists, public.therapist_services,
  public.media_assets, public.intake_questions,
  public.site_content, public.faqs, public.testimonials, public.gallery_items, public.announcements
to anon, authenticated;

-- Staff-managed tables.
grant select, insert, update, delete on
  public.profiles, public.business_hours, public.blackout_dates, public.dispatch_zones,
  public.services, public.service_package_items, public.therapists, public.therapist_services,
  public.therapist_schedules, public.therapist_breaks, public.therapist_time_off,
  public.customers, public.appointments, public.appointment_intake_answers,
  public.media_assets, public.intake_questions,
  public.site_content, public.faqs, public.testimonials, public.gallery_items, public.announcements
to authenticated;
grant update on public.business_settings to authenticated;

-- Holds and payments are written only by server-side code, so the figures the
-- dashboard reports always come from verified records.
grant select on public.booking_holds, public.payments to authenticated;
-- payment_events: service_role only.

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.media_assets enable row level security;
alter table public.business_settings enable row level security;
alter table public.business_hours enable row level security;
alter table public.blackout_dates enable row level security;
alter table public.dispatch_zones enable row level security;
alter table public.services enable row level security;
alter table public.service_package_items enable row level security;
alter table public.therapists enable row level security;
alter table public.therapist_services enable row level security;
alter table public.therapist_schedules enable row level security;
alter table public.therapist_breaks enable row level security;
alter table public.therapist_time_off enable row level security;
alter table public.customers enable row level security;
alter table public.booking_holds enable row level security;
alter table public.appointments enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.intake_questions enable row level security;
alter table public.appointment_intake_answers enable row level security;
alter table public.site_content enable row level security;
alter table public.faqs enable row level security;
alter table public.testimonials enable row level security;
alter table public.gallery_items enable row level security;
alter table public.announcements enable row level security;

-- Owner/admin: full management of every staff-managed table.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'business_hours', 'blackout_dates', 'dispatch_zones',
    'services', 'service_package_items', 'therapists', 'therapist_services',
    'therapist_schedules', 'therapist_breaks', 'therapist_time_off',
    'customers', 'appointments', 'appointment_intake_answers',
    'media_assets', 'intake_questions',
    'site_content', 'faqs', 'testimonials', 'gallery_items', 'announcements'
  ]
  loop
    execute format(
      'create policy "admin manage" on public.%I for all to authenticated
         using ((select private.is_admin())) with check ((select private.is_admin()))', t);
  end loop;
end;
$$;

create policy "admin update" on public.business_settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin read" on public.booking_holds for select to authenticated
  using ((select private.is_admin()));
create policy "admin read" on public.payments for select to authenticated
  using ((select private.is_admin()));

-- Public website content.
create policy "public read" on public.business_settings for select to anon, authenticated using (true);
create policy "public read" on public.business_hours for select to anon, authenticated using (true);
create policy "public read" on public.media_assets for select to anon, authenticated using (true);
create policy "public read" on public.service_package_items for select to anon, authenticated using (true);
create policy "public read" on public.therapist_services for select to anon, authenticated using (true);
create policy "public read active" on public.dispatch_zones for select to anon, authenticated using (is_active);
create policy "public read active" on public.services for select to anon, authenticated using (is_active);
create policy "public read active" on public.therapists for select to anon, authenticated using (is_active);
create policy "public read enabled" on public.intake_questions for select to anon, authenticated using (is_enabled);
create policy "public read published" on public.site_content for select to anon, authenticated using (is_published);
create policy "public read published" on public.faqs for select to anon, authenticated using (is_published);
create policy "public read published" on public.testimonials for select to anon, authenticated using (is_published);
create policy "public read published" on public.gallery_items for select to anon, authenticated using (is_published);
create policy "public read current" on public.announcements for select to anon, authenticated
  using (
    is_published
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );

-- Staff: own profile.
create policy "read own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()));

-- Therapists: their own schedule inputs and the business blackout dates.
create policy "therapist read own" on public.therapist_schedules for select to authenticated
  using (therapist_id = (select private.therapist_id()));
create policy "therapist read own" on public.therapist_breaks for select to authenticated
  using (therapist_id = (select private.therapist_id()));
create policy "therapist read own" on public.therapist_time_off for select to authenticated
  using (therapist_id = (select private.therapist_id()));
create policy "staff read" on public.blackout_dates for select to authenticated
  using ((select private.staff_role()) is not null);

-- Therapists: their own appointments, and only the customers and intake
-- answers attached to those appointments.
create policy "therapist read own" on public.appointments for select to authenticated
  using (therapist_id = (select private.therapist_id()));
create policy "therapist read own customers" on public.customers for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.customer_id = customers.id and a.therapist_id = (select private.therapist_id())
    )
  );
create policy "therapist read own intake" on public.appointment_intake_answers for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_intake_answers.appointment_id
        and a.therapist_id = (select private.therapist_id())
    )
  );
