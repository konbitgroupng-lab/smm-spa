# Development guide

SMM is a React 19 + Vite + Tailwind site backed by Supabase (Postgres, Auth, Row Level Security, Storage). This guide covers the Phase 1 foundation: what exists, how to run it, and the rules the rest of the build relies on.

## Current state

| Area | Status |
| --- | --- |
| Public site (`src/App.tsx`) | Unchanged. Still renders static content from `src/data.ts` and the placeholder Calendly widget. |
| Database schema, RLS, storage bucket | Done, as migrations in `supabase/migrations/`. |
| Data-access layer (`src/services/`) | Done. Not yet wired into the page components (Phase 4). |
| Availability engine, public hold endpoint | Phase 2. |
| Payments (Paystack behind a `PaymentGateway` interface) | Phase 3. |
| Booking funnel, admin dashboard, CMS screens | Phases 4-6. |

## Quick start

```bash
npm install
npm run dev        # site on http://localhost:3000 (works without Supabase)
npm test           # database + service tests; no Docker or Supabase account needed
npm run lint       # type check
```

### Local Supabase (needs Docker Desktop running)

```bash
npm run db:start   # starts Postgres, Auth, Storage, Studio; prints the URL and keys
npm run db:reset   # re-applies all migrations and loads supabase/seed.sql
```

Copy `.env.example` to `.env.local` and fill it from the `db:start` output:

| Variable | Where it is used | Safe in the browser? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | frontend | Yes |
| `VITE_SUPABASE_ANON_KEY` | frontend | Yes. RLS limits what it can do. |
| `SUPABASE_URL` | local scripts | n/a |
| `SUPABASE_SERVICE_ROLE_KEY` | local scripts, later Edge Functions | **No. Server only.** It bypasses RLS. |
| `DEMO_USER_PASSWORD` | `db:seed-users` | **No.** Optional. |
| `PAYSTACK_SECRET_KEY` (Phase 3) | Edge Functions | **No. Server only.** |

Anything prefixed `VITE_` is compiled into the public JavaScript bundle, so a secret must never get that prefix. In production, server-only values are set with `supabase secrets set`; they are never stored in the database or editable from the admin dashboard.

Then create demo staff logins (local only; the script refuses hosted projects):

```bash
npm run db:seed-users
```

This creates `demo.owner@example.com` and `demo.therapist@example.com`. The password comes from `DEMO_USER_PASSWORD`, or is generated and printed once.

## Database

Money is stored in minor units (kobo). Times are `timestamptz`; the business timezone (`Africa/Lagos`) is in `business_settings`.

| Group | Tables |
| --- | --- |
| Staff | `profiles` (one per Auth user: role, active flag) |
| Catalogue | `services` (includes packages), `service_package_items`, `therapists`, `therapist_services`, `dispatch_zones` |
| Availability inputs | `business_hours`, `blackout_dates`, `therapist_schedules`, `therapist_breaks`, `therapist_time_off` |
| Bookings | `customers`, `booking_holds`, `appointments` |
| Payments | `payments`, `payment_events` (webhook log) |
| Intake | `intake_questions`, `appointment_intake_answers` |
| Content | `site_content`, `faqs`, `testimonials`, `gallery_items`, `announcements`, `media_assets` |
| Settings | `business_settings` (single row, non-sensitive only) |

### How double booking is prevented

Each hold and appointment stores `starts_at`, `ends_at` and `blocked_until` (end plus turnover buffer). For one therapist, the range `starts_at`-`blocked_until` may never overlap another live reservation:

1. An exclusion constraint on `booking_holds` rejects overlapping active holds.
2. An exclusion constraint on `appointments` rejects overlapping live appointments (`pending_payment`, `confirmed`, `completed`).
3. Guard triggers check holds against appointments and the reverse, under a per-therapist advisory lock so concurrent requests queue instead of racing.

A hold lasts `business_settings.hold_minutes` (10). Once `expires_at` passes it stops blocking immediately; `release_expired_booking_holds()` only tidies up. An appointment created from a hold carries `hold_id`, so its own hold does not block it.

`create_booking_hold()` is callable by `service_role` only. It does not yet check the slot against opening hours or shifts; Phase 2 adds that and the public entry point.

## Authentication and authorization

- Supabase Auth, email + password. Public sign-up is disabled: staff are invited, customers book as guests.
- A trigger creates a `profiles` row for every Auth user as an **inactive therapist**. Sign-up metadata can never set a role.
- RLS is enabled on every table. Access is decided by `private.is_admin()` and `private.therapist_id()`, which read the caller's active profile.

| Who | Can do |
| --- | --- |
| Guest (`anon`) | Read active services, therapists, zones, opening hours, published content, enabled intake questions. Nothing else. |
| Therapist | The above, plus read their own schedule, their own appointments, and the customers and intake answers attached to those appointments. No writes. |
| Owner / admin | Manage catalogue, schedules, customers, appointments, content and media. Read holds and payments. |
| `service_role` (Edge Functions) | Everything. The only writer of `booking_holds`, `payments` and `payment_events`, so payment figures cannot be edited from the dashboard. |

Owner and admin have identical rights in Phase 1.

### Storage

One public bucket, `site-media` (5 MB limit; JPEG, PNG, WebP, AVIF), with folders `services/`, `therapists/`, `gallery/`, `site/`. Only owner/admin can upload, replace or delete. Tables reference files through `media_assets`; the `image_url` / `photo_url` columns hold the current static paths until images are migrated.

## Frontend data layer

`src/lib/supabase.ts` creates the browser client from the two `VITE_` variables. `src/services/*` is the only code that talks to Supabase:

- `catalogService`, `contentService`: public reads. They return the same shapes as `src/data.ts`, and fall back to that static content when Supabase is not configured.
- `authService`: staff sign-in, sign-out, password reset, current profile.
- `appointmentsService`: staff reads of appointments and customers; admin customer creation.

`localStorage` must not become a source of truth for any of this. The in-page booking form in `src/App.tsx` still saves to `localStorage`; it is replaced in Phase 4.

## Demo data

`supabase/seed.sql` is for local development and tests only. Rows that could be mistaken for client information carry `is_demo = true`, and invented people are named `[DEMO] ...`. `supabase/snippets/purge_demo_data.sql` removes them.

## Tests

`npm test` runs the real migrations and seed in an in-process Postgres (PGlite) on top of a small Supabase stand-in (`tests/db/supabase-shim.sql`: API roles, `auth.users`, `auth.uid()`, storage tables).

| File | Covers |
| --- | --- |
| `tests/db/foundation.test.ts` | Migrations apply, RLS on every table, profile trigger, role helpers, per-role access, customer and appointment creation, storage policies |
| `tests/db/booking.test.ts` | Hold creation, overlap prevention (hold/hold, hold/appointment, appointment/appointment, buffer), expired holds |
| `tests/services/catalog.test.ts` | Money formatting, static fallback, database rows mapped to site shapes |

Limits: PGlite is a single connection, so the tests prove the constraints reject conflicts but do not exercise truly simultaneous transactions. Supabase Auth itself (login, password reset emails) and real Storage uploads are not covered; check those against a local or hosted Supabase project.

## Going to a hosted Supabase project

1. Create the project, then `npx supabase link --project-ref <ref>` and `npx supabase db push`. Do **not** run `seed.sql` there.
2. In Authentication settings: disable sign-ups, set the Site URL and redirect URLs, minimum password length 10. (`supabase/config.toml` only configures the local stack.)
3. Invite the owner from Authentication > Users, then promote them once in the SQL editor:

   ```sql
   update public.profiles set role = 'owner', is_active = true
   where id = (select id from auth.users where email = 'owner@their-domain');
   ```

4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel. The service-role key is not needed by the site.
5. Regenerate types once the project exists: `npx supabase gen types typescript --linked > src/lib/database.types.ts`.
