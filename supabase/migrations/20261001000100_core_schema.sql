-- Phase 1: core schema.
-- The database is the source of truth for the catalogue, schedules, bookings,
-- customers, payments and website content. RLS and grants live in the next migration.

create extension if not exists btree_gist with schema extensions;

-- Helper functions live here so they are not exposed through the REST API.
create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.staff_role as enum ('owner', 'admin', 'therapist');
create type public.location_type as enum ('sanctuary', 'mobile');
create type public.appointment_status as enum ('pending_payment', 'confirmed', 'completed', 'cancelled', 'no_show');
create type public.hold_status as enum ('active', 'converted', 'released', 'expired');
create type public.payment_kind as enum ('deposit', 'full');
create type public.payment_status as enum (
  'initialized', 'pending', 'succeeded', 'failed', 'abandoned', 'refunded', 'partially_refunded'
);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
-- One row per Supabase Auth user. New accounts start inactive with the lowest
-- role; an owner/admin activates them and sets the role.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.staff_role not null default 'therapist',
  full_name text not null default '',
  phone text,
  is_active boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Media (files live in Supabase Storage; this table only references them)
-- ---------------------------------------------------------------------------
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'site-media',
  path text not null,
  alt_text text not null default '',
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  is_demo boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bucket, path)
);

-- ---------------------------------------------------------------------------
-- Business configuration (non-sensitive only; secrets never live in the database)
-- ---------------------------------------------------------------------------
create table public.business_settings (
  id boolean primary key default true check (id), -- singleton row
  business_name text not null default '',
  timezone text not null default 'Africa/Lagos',
  currency char(3) not null default 'NGN',
  online_payment_enabled boolean not null default false,
  payment_mode public.payment_kind not null default 'full',
  deposit_percent integer not null default 50 check (deposit_percent between 1 and 100),
  hold_minutes integer not null default 10 check (hold_minutes between 1 and 60),
  default_buffer_minutes integer not null default 15 check (default_buffer_minutes >= 0),
  slot_interval_minutes integer not null default 30 check (slot_interval_minutes between 5 and 240),
  min_lead_minutes integer not null default 120 check (min_lead_minutes >= 0),
  max_advance_days integer not null default 60 check (max_advance_days > 0),
  updated_at timestamptz not null default now()
);

-- day_of_week follows Postgres extract(dow): 0 = Sunday ... 6 = Saturday.
create table public.business_hours (
  day_of_week smallint primary key check (day_of_week between 0 and 6),
  is_closed boolean not null default false,
  opens_at time,
  closes_at time,
  check (is_closed or (opens_at is not null and closes_at is not null and opens_at < closes_at))
);

create table public.blackout_dates (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

-- Travel fee zones for mobile (in-home) appointments.
create table public.dispatch_zones (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  fee_minor bigint not null default 0 check (fee_minor >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
-- Money is stored in minor units (kobo for NGN) to match payment providers.
create table public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null default '',
  description text not null default '',
  benefits text[] not null default '{}',
  duration_minutes integer not null check (duration_minutes > 0),
  buffer_minutes integer not null default 15 check (buffer_minutes >= 0),
  price_minor bigint not null check (price_minor >= 0),
  compare_at_price_minor bigint check (compare_at_price_minor is null or compare_at_price_minor >= price_minor),
  currency char(3) not null default 'NGN',
  is_package boolean not null default false,
  is_popular boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  image_url text, -- static/legacy path; image_media_id wins when set
  image_media_id uuid references public.media_assets (id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_package_items (
  package_id uuid not null references public.services (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete restrict,
  sort_order integer not null default 0,
  primary key (package_id, service_id),
  check (package_id <> service_id)
);

create table public.therapists (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  display_name text not null,
  title text not null default '',
  specialty text not null default '',
  bio text not null default '',
  photo_url text, -- static/legacy path; photo_media_id wins when set
  photo_media_id uuid references public.media_assets (id) on delete set null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.therapist_services (
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  primary key (therapist_id, service_id)
);

-- ---------------------------------------------------------------------------
-- Therapist availability inputs (availability itself is computed server-side in Phase 2)
-- ---------------------------------------------------------------------------
create table public.therapist_schedules (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (start_time < end_time)
);
create index therapist_schedules_therapist_idx on public.therapist_schedules (therapist_id, day_of_week);

create table public.therapist_breaks (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (start_time < end_time)
);
create index therapist_breaks_therapist_idx on public.therapist_breaks (therapist_id, day_of_week);

create table public.therapist_time_off (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);
create index therapist_time_off_therapist_idx on public.therapist_time_off (therapist_id, starts_at);

-- ---------------------------------------------------------------------------
-- Customers (guests; no login)
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  email text not null check (position('@' in email) > 1),
  phone text,
  staff_notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_email_key on public.customers (lower(email));

-- ---------------------------------------------------------------------------
-- Booking holds and appointments
-- ---------------------------------------------------------------------------
-- blocked_until = ends_at + turnover buffer. A therapist's blocked ranges may
-- never overlap; see the exclusion constraints below and the guard triggers in
-- the booking migration.
create table public.booking_holds (
  id uuid primary key default gen_random_uuid(),
  hold_token uuid not null unique default gen_random_uuid(),
  service_id uuid not null references public.services (id) on delete restrict,
  therapist_id uuid not null references public.therapists (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked_until timestamptz not null,
  expires_at timestamptz not null,
  status public.hold_status not null default 'active',
  location_type public.location_type not null default 'sanctuary',
  dispatch_zone_id uuid references public.dispatch_zones (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  check (ends_at <= blocked_until),
  constraint booking_holds_no_overlap exclude using gist (
    therapist_id with =,
    tstzrange(starts_at, blocked_until) with &&
  ) where (status = 'active')
);
create index booking_holds_expiry_idx on public.booking_holds (expires_at) where status = 'active';

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique
    default ('SMM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  customer_id uuid not null references public.customers (id) on delete restrict,
  service_id uuid not null references public.services (id) on delete restrict,
  therapist_id uuid not null references public.therapists (id) on delete restrict,
  hold_id uuid unique references public.booking_holds (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked_until timestamptz not null,
  status public.appointment_status not null default 'pending_payment',
  location_type public.location_type not null default 'sanctuary',
  dispatch_zone_id uuid references public.dispatch_zones (id) on delete set null,
  service_address text,
  -- Prices are copied at booking time so later catalogue edits never rewrite history.
  price_minor bigint not null check (price_minor >= 0),
  dispatch_fee_minor bigint not null default 0 check (dispatch_fee_minor >= 0),
  total_minor bigint generated always as (price_minor + dispatch_fee_minor) stored,
  currency char(3) not null default 'NGN',
  customer_notes text,
  cancelled_at timestamptz,
  cancellation_reason text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  check (ends_at <= blocked_until),
  check (location_type = 'sanctuary' or length(trim(coalesce(service_address, ''))) > 0),
  constraint appointments_no_overlap exclude using gist (
    therapist_id with =,
    tstzrange(starts_at, blocked_until) with &&
  ) where (status in ('pending_payment', 'confirmed', 'completed'))
);
create index appointments_therapist_idx on public.appointments (therapist_id, starts_at);
create index appointments_customer_idx on public.appointments (customer_id, starts_at desc);
create index appointments_starts_at_idx on public.appointments (starts_at);

-- ---------------------------------------------------------------------------
-- Payments (no card data: only provider references, amounts and status)
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments (id) on delete restrict,
  hold_id uuid references public.booking_holds (id) on delete set null,
  provider text not null check (provider in ('paystack', 'stripe')),
  provider_reference text not null,
  kind public.payment_kind not null default 'full',
  status public.payment_status not null default 'initialized',
  amount_minor bigint not null check (amount_minor > 0),
  refunded_minor bigint not null default 0 check (refunded_minor >= 0),
  currency char(3) not null default 'NGN',
  is_test boolean not null, -- provider test mode vs live mode
  paid_at timestamptz,
  failure_reason text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_reference),
  check (refunded_minor <= amount_minor)
);
create index payments_appointment_idx on public.payments (appointment_id);
create index payments_hold_idx on public.payments (hold_id);

-- Verified webhook deliveries; the unique key makes webhook handling idempotent.
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('paystack', 'stripe')),
  event_id text not null,
  event_type text not null,
  payment_id uuid references public.payments (id) on delete set null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- Intake (optional, owner-configurable; sensitive)
-- ---------------------------------------------------------------------------
create table public.intake_questions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  help_text text,
  input_type text not null default 'text'
    check (input_type in ('text', 'textarea', 'single_choice', 'multi_choice')),
  options jsonb not null default '[]'::jsonb,
  is_enabled boolean not null default false,
  is_required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointment_intake_answers (
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  question_id uuid not null references public.intake_questions (id) on delete cascade,
  answer text not null,
  created_at timestamptz not null default now(),
  primary key (appointment_id, question_id)
);

-- ---------------------------------------------------------------------------
-- Website content (CMS)
-- ---------------------------------------------------------------------------
-- Keyed blocks: homepage copy, contact information, and so on.
create table public.site_content (
  key text primary key,
  value jsonb not null,
  description text,
  is_published boolean not null default true,
  is_demo boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text[] not null, -- one element per paragraph
  sort_order integer not null default 0,
  is_published boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.testimonials (
  id uuid primary key default gen_random_uuid(),
  author_name text not null,
  author_location text,
  body text not null,
  rating smallint not null check (rating between 1 and 5),
  service_id uuid references public.services (id) on delete set null,
  sort_order integer not null default 0,
  is_published boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default '',
  image_url text, -- static/legacy path; image_media_id wins when set
  image_media_id uuid references public.media_assets (id) on delete set null,
  sort_order integer not null default 0,
  is_published boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (image_url is not null or image_media_id is not null)
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'announcement' check (kind in ('announcement', 'promotion')),
  title text not null,
  body text not null default '',
  starts_at timestamptz,
  ends_at timestamptz,
  is_published boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or starts_at < ends_at)
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'business_settings', 'dispatch_zones', 'services', 'therapists', 'customers',
    'booking_holds', 'appointments', 'payments', 'intake_questions', 'site_content', 'faqs',
    'testimonials', 'gallery_items', 'announcements'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function private.set_updated_at()', t);
  end loop;
end;
$$;
