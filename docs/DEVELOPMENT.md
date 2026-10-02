# Development guide

SMM is a React 19 + Vite + Tailwind site backed by Supabase (Postgres, Auth, Row Level Security, Storage, Edge Functions). This guide covers Phases 1-3: what exists, how to run it, and the rules the rest of the build relies on.

## Current state

| Area | Status |
| --- | --- |
| Public site (`src/App.tsx`) | Unchanged. Still renders static content from `src/data.ts` and the placeholder Calendly widget. |
| Database schema, RLS, storage bucket | Done (Phase 1), as migrations in `supabase/migrations/`. |
| Data-access layer (`src/services/`) | Done. Not yet wired into the page components (Phase 4). |
| Availability engine, validated holds, public `booking` endpoint | Done (Phase 2). |
| Payments (Paystack behind a `PaymentGateway` interface) | Done (Phase 3), tested against a simulated Paystack. Not yet run with real Paystack test credentials. |
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

`create_booking_hold()` is the low-level reservation: it skips the schedule rules below and is callable by `service_role` only (intended for staff overrides in the dashboard). Guests always go through `request_booking_hold()`.

### Availability and guest holds

`private.slot_block_reason()` is the single rule set. A therapist can take a slot only if it:

- starts on the booking grid (`slot_interval_minutes`, counted from local midnight),
- is at least `min_lead_minutes` away and within `max_advance_days`,
- starts and ends inside opening hours on one day, outside any blackout,
- lies inside one of the therapist's shifts, clear of breaks and time off,
- does not overlap a live appointment or unexpired hold, buffers included.

Day and time rules are evaluated in `business_settings.timezone`.

| Function | Caller | Purpose |
| --- | --- | --- |
| `get_available_slots(service, date, therapist?)` | Guests (read-only) | Free start times for a local date, per therapist |
| `request_booking_hold(service, starts_at, therapist?, location, zone, replace_token?)` | Edge Function | Validates with the rule set, then reserves. No therapist given: the free therapist with the fewest appointments that day, then display order. `replace_token` releases the guest's previous hold in the same transaction. |
| `attach_customer_to_hold(token, name, email, phone)` | Edge Function | Adds guest details. A known email links to the existing customer without changing it. |
| `release_booking_hold(token)` | Edge Function | Guest gives the slot back |
| `consume_rate_limit(key, limit, window)` | Edge Function | Fixed-window counter in `private.rate_limit_hits` |
| `run_booking_maintenance()` | pg_cron, every minute | Marks expired holds, prunes old counters |

`request_booking_hold` raises `slot_unavailable` (SQLSTATE `23P01`) with the reason in `DETAIL`: `slot_taken`, `off_grid`, `too_soon`, `too_far`, `outside_business_hours`, `blackout`, `outside_shift`, `on_break`, `time_off`.

### The `booking` Edge Function

`supabase/functions/booking/` is the only public way to reserve a slot. `handler.ts` holds the logic (Web-standard APIs only, so it is unit-tested in Node); `index.ts` is the Deno entry point.

`POST` a JSON body with an `action`:

| Action | Fields | Success |
| --- | --- | --- |
| `create_hold` | `serviceId`, `startsAt`, optional `therapistId`, `locationType`, `dispatchZoneId`, `replaceHoldToken` | `{ hold }` |
| `attach_customer` | `holdToken`, `fullName`, `email`, `phone` | `{ hold }` |
| `release_hold` | `holdToken` | `{ released }` |

A `hold` contains `token`, `therapistId`, `startsAt`, `endsAt`, `expiresAt`, `hasCustomer` and nothing else. Errors are `{ error, reason? }` with status 400 (`invalid_request`), 409 (`slot_unavailable`), 410 (`hold_expired`), 422 (`service_unavailable`, `therapist_unavailable`, `dispatch_zone_required`, `invalid_customer`), 429 (`rate_limited`) or 500 (`server_error`, no detail).

Limits per visitor per 10 minutes: 10 hold attempts, 30 of each other action. The visitor key is a salted hash of the IP address.

Function secrets: `ALLOWED_ORIGINS` (comma-separated site origins for CORS) and `RATE_LIMIT_SALT`. Serve locally with `npx supabase functions serve booking`; deploy with `npx supabase functions deploy booking`.

## Payments

### The rule

`public.record_payment_result()` is the only code that can turn a payment into an appointment. The browser-triggered `verify` call and the Paystack webhook both end there, and both pass it what Paystack's verify API reported, never what the browser or the webhook body claimed. In one transaction it either attaches the payment to a new confirmed appointment or flags the payment as needing a refund.

Lock order, wherever more than one lock is taken: therapist advisory lock, then the `booking_holds` row, then the `payments` row.

### Flow

1. The guest holds a slot and adds their details (Phase 2).
2. `payments` function, action `initialize`: `begin_hold_payment()` computes the amount from the catalogue and business settings (full, or the deposit percentage rounded up), snapshots the price on the hold, creates the `payments` row, and extends the hold once to `payment_window_minutes` (15). The function then creates the transaction at Paystack and returns the hosted checkout address.
3. The guest pays on Paystack's page and is sent back with `?reference=...`.
4. `payments` function, action `verify`, and/or the `paystack-webhook` function ask Paystack for the transaction and call `record_payment_result()`.

### Payment status

| Status | Meaning | Can become |
| --- | --- | --- |
| `initialized` | Record created, guest sent to checkout | `pending`, `succeeded`, `failed`, `abandoned` |
| `pending` | Provider reports it in progress | `succeeded`, `failed`, `abandoned` |
| `succeeded` | Provider confirmed the money | `partially_refunded`, `refunded` |
| `failed` | Provider reported failure | `succeeded`, if the provider later confirms that reference |
| `abandoned` | No result `payment_abandon_minutes` (30) after it started | `succeeded`, if a late payment arrives |
| `partially_refunded`, `refunded` | Set from provider refund events | |

A succeeded payment has either `appointment_id` set, or `needs_refund = true` with `needs_refund_reason`:

| Reason | When |
| --- | --- |
| `slot_retaken` | The hold had expired and another reservation now has the slot |
| `hold_released` | The guest released the hold, then paid, and the slot is gone |
| `slot_passed` | The slot's start time has already passed |
| `amount_mismatch`, `currency_mismatch` | The provider reports something other than what the database expected |
| `duplicate_payment` | Another payment already booked this hold |
| `hold_missing` | The hold no longer exists |

A late payment is still honoured when the slot is free: the insert goes through the same exclusion constraints and guard triggers as every other reservation, so it can never displace one.

Refunds are recorded, never initiated. Paystack's `refund.pending`, `refund.processing`, `refund.processed` and `refund.failed` events update `refund_status` (`none`, `pending`, `processing`, `processed`, `failed`, `needs_attention`), `refund_reference`, `refund_reason`, `refund_error`, the refund timestamps and `refunded_minor`. `refundable_minor` is what is left to refund. `paid_minor`, `paid_currency` and `provider_transaction_id` hold what Paystack reported for the original charge.

### Webhook handling

1. The signature (`x-paystack-signature`, HMAC-SHA512 of the raw body keyed with the secret key) is checked with a constant-time comparison. Anything else gets 401 and leaves no trace.
2. The delivery is logged in `payment_events` under a unique key (event name plus transaction id or refund reference). Only non-sensitive fields are stored; the card authorization and customer details are dropped.
3. For `charge.success`, the transaction is verified with Paystack and the result goes to `record_payment_result()`.
4. The delivery is marked processed and answered with 200. If anything fails, the answer is 500 and the delivery stays unprocessed, so Paystack's retry processes it again.

A repeat of an already processed delivery is acknowledged without doing anything. Simultaneous repeats are safe because `record_payment_result()` serialises on its locks and returns the existing outcome.

### Functions and secrets

| Function | Caller | Purpose |
| --- | --- | --- |
| `payments` (`initialize`, `verify`) | Guests | Start a payment; get its verified outcome (`confirmed`, `pending`, `failed`, `refund_required`) |
| `paystack-webhook` | Paystack | Signed event receiver |

`supabase/functions/_shared/payments/gateway.ts` defines `PaymentGateway`; `paystack.ts` implements it. Handlers use only the interface.

`PAYSTACK_SECRET_KEY` is a function secret and nothing else: it is never in the database, the browser bundle or an admin screen. Test or live mode is read from the key (`sk_test_` / `sk_live_`) and stored on each payment as `is_test`. `business_settings.online_payment_enabled` must be true for payments to start.

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
- `bookingService`: guest availability (`getAvailableSlots`) and hold actions through the `booking` function. Failures throw `BookingError` with the codes above.
- `paymentService`: `startPayment` and `verifyPayment` through the `payments` function. Only a `confirmed` outcome from `verifyPayment` means a booking exists.

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
| `tests/db/availability.test.ts` | Slot listing against every rule, validated holds, therapist assignment, hold replacement, customer details, rate limiting, maintenance |
| `tests/functions/booking-handler.test.ts` | The endpoint handler against the real database functions: validation, status codes, rate limiting, CORS, no leaked internals |
| `tests/db/concurrency.test.ts` | 24 simultaneous connections on a real PostgreSQL 18 server (`embedded-postgres`): one winner per slot, no deadlocks, no overlaps |
| `tests/db/payments.test.ts` | The payment state machine: amounts, deposit, hold extension, success, failure, retry, abandonment, mismatches, late payments, refund events, privileges |
| `tests/functions/paystack-adapter.test.ts` | The Paystack adapter against a simulated Paystack (`tests/support/fake-paystack.ts`): initialize, verify, signatures, event parsing |
| `tests/functions/payments-handler.test.ts` | The `payments` and `paystack-webhook` handlers end to end: database, adapter and simulated Paystack |
| `tests/db/payments-concurrency.test.ts` | Payment races on real PostgreSQL: duplicate webhooks, webhook against verify, late payment against a new guest |

Limits: Supabase Auth itself (login, password reset emails), real Storage uploads, the Deno entry point `index.ts`, the pg_cron schedule and PostgREST's handling of the RPC calls are not covered; check those against a local or hosted Supabase project.

## Open issues carried forward

Decide or fix these in the booking-funnel and payment phases:

- **Mobile travel time.** A mobile appointment blocks only the service duration and the normal turnover buffer; no extra travel time is reserved. Needs the client's input.
- **Real Paystack not yet exercised.** Phase 3 was tested against a simulated Paystack. Before go-live, run it with the client's Paystack test key (see "Going to a hosted Supabase project") and confirm the response shapes match.
- **Refunds are manual.** Payments flagged `needs_refund` must be refunded by the owner in the Paystack dashboard; the resulting Paystack events update the record. Nothing alerts staff to a flagged payment until the Phase 5 dashboard exists.
- **Several partial refunds.** Each payment stores one refund reference and a running total; a per-refund history table is left for the refund workflow.
- **Deposit balances.** A deposit confirms the booking; collecting the remainder is not handled online.
- **Schedule changes after a hold.** At payment time only the slot itself is re-checked (other reservations, start time not passed), not shifts or time off added after the hold was made.
- **Staff view of contact details.** Appointments now keep the name and phone typed for that booking (`contact_name`, `contact_phone`); `appointmentsService` does not show them yet.
- **A guest's own hold hides its slot.** While a guest holds a time, the availability listing shows that time as taken, including to that guest.
- **Rate limiting is per IP address.** Visitors sharing one network share a limit. The limits are constants in `supabase/functions/booking/handler.ts`.
- **`embedded-postgres` is a development/test-only dependency.** It downloads PostgreSQL binaries and is never part of the deployed site.
- **Site content.** The live page still shows testimonials with realistic names, therapist star ratings and a street address that the client has not verified.
- **Legacy booking form.** The in-page form in `src/App.tsx` still saves bookings to `localStorage` (`everest_bookings`).
- **Paystack eligibility.** The client's merchant account has not been confirmed.
- **Intake data retention.** Access is restricted by RLS, but nothing deletes intake answers automatically.

## Going to a hosted Supabase project

1. Create the project, then `npx supabase link --project-ref <ref>` and `npx supabase db push`. Do **not** run `seed.sql` there.
2. In Authentication settings: disable sign-ups, set the Site URL and redirect URLs, minimum password length 10. (`supabase/config.toml` only configures the local stack.)
3. Invite the owner from Authentication > Users, then promote them once in the SQL editor:

   ```sql
   update public.profiles set role = 'owner', is_active = true
   where id = (select id from auth.users where email = 'owner@their-domain');
   ```

4. Deploy the functions and their secrets: `npx supabase functions deploy booking payments paystack-webhook --use-api`, then `npx supabase secrets set ALLOWED_ORIGINS=https://<site> RATE_LIMIT_SALT=<random> PAYSTACK_SECRET_KEY=sk_test_...`. Confirm the `booking-maintenance` job exists under Integrations > Cron.
   In the Paystack dashboard (Settings > API Keys & Webhooks), set the webhook URL to `https://<project-ref>.supabase.co/functions/v1/paystack-webhook`. Turn payments on with `update public.business_settings set online_payment_enabled = true`.
5. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel. The service-role key is not needed by the site.
6. Regenerate types once the project exists: `npx supabase gen types typescript --linked > src/lib/database.types.ts`.
