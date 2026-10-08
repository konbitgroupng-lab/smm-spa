# Development guide

SMM is a React 19 + Vite + Tailwind site backed by Supabase (Postgres, Auth, Row Level Security, Storage, Edge Functions). This guide covers Phases 1-4 and Phase 5 (5a-5e: staff security foundation; appointment and customer operations; schedule and catalogue; payments, refunds, staff and audit; final integration): what exists, how to run it, and the rules the rest of the build relies on.

## Current state

| Area | Status |
| --- | --- |
| Public site (`src/App.tsx`) | Sections unchanged, except the booking area (now the funnel), the service and package cards (database catalogue, static fallback) and the removal of "My Bookings". |
| Database schema, RLS, storage bucket | Done (Phase 1), as migrations in `supabase/migrations/`. |
| Data-access layer (`src/services/`) | Done; used by the booking funnel and the service and package cards. |
| Availability engine, validated holds, public `booking` endpoint | Done (Phase 2). |
| Payments (`PaymentGateway` interface) | Done (Phase 3 prototype). Runs on the **demo gateway**: no real money moves. The Paystack adapter is built and tested but not connected; see "Future Paystack integration". |
| Public booking funnel and confirmation page | Done (Phase 4); see "Booking funnel". |
| Staff security foundation: role hardening, audit log, staff functions, two-factor readiness | Done (Phase 5a); see "Authentication and authorization". |
| Appointment and customer operations | Done (Phase 5b): staff home, bookings (list, day by therapist, week), appointment detail and actions, phone/WhatsApp bookings, customers, therapist agenda. See "Appointment operations". |
| Schedule and catalogue management | Done (Phase 5c): opening hours, therapist weeks, time off, closures, booking rules, conflicts; treatments, packages, therapists and their treatments, in-home areas. See "Schedule and catalogue". |
| Payments, refunds, staff accounts, settings, activity log | Done (Phase 5d). See "Payments, refunds, staff and audit". |
| Phase 5 integration and security review | Done (Phase 5e). See "Phase 5e integration" and [PHASE-5-SECURITY-REVIEW.md](PHASE-5-SECURITY-REVIEW.md). |
| Staff app (`/staff/`) | Sign-in, password links, role-based navigation, own account (5a); every Phase 5 screen above. |
| CMS, analytics, notifications | Phase 6; see "Deferred to Phases 5 and 6". |

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
| `PAYMENT_PROVIDER` | Edge Functions | Server setting: `mock` (demo payments) or `paystack`. |
| `PAYSTACK_SECRET_KEY` | Edge Functions, only with `PAYMENT_PROVIDER=paystack` | **No. Server only.** Not needed until Paystack is connected. |

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

Lock order, wherever more than one lock is taken: schedule-rules lock, then the therapist advisory lock, then the `booking_holds` row, then the `payments` row.

### Scheduling rules are re-checked at payment time

Before creating the appointment, `record_payment_result()` runs the same rule set as availability (`private.slot_block_reason`) against the rules as they are now: opening hours, shifts, breaks, time off, blackout dates, minimum notice, booking window, grid and other reservations. It also checks that the service is still active with the same duration and buffer, and that the therapist is still active and offers it.

- Minimum notice and the booking window are measured from when the booking was made. For a live hold that is the hold's creation time, so a guest is not refused because minutes passed while they paid. A hold that has lapsed counts as a new booking made at payment time.
- The payer's own hold never blocks its own slot.
- There is no gap between the check and the insert. Every statement that changes a rule table (`business_settings`, `business_hours`, `blackout_dates`, `therapist_schedules`, `therapist_breaks`, `therapist_time_off`, `services`, `therapists`, `therapist_services`) takes the schedule-rules advisory lock exclusively through a trigger. `record_payment_result()` holds it in shared mode from before the check until commit. A rule change therefore either commits first and is seen, or waits until the appointment exists and is visible to whoever made the change.

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
| `schedule_changed` | A scheduling rule no longer allows the slot. `needs_refund_detail` names it: `time_off`, `blackout`, `on_break`, `outside_shift`, `outside_business_hours`, `too_soon`, `too_far`, `off_grid` |
| `service_changed` | The service was withdrawn (`inactive`) or its duration or buffer changed (`duration`) after the slot was held |
| `therapist_unavailable` | The therapist was deactivated or no longer offers the service |
| `zone_unavailable` | An in-home booking's area was deactivated before the payment completed (5c) |

A late payment is still honoured when the slot is free: the insert goes through the same exclusion constraints and guard triggers as every other reservation, so it can never displace one.

Refunds are recorded, never initiated. Paystack's `refund.pending`, `refund.processing`, `refund.processed`, `refund.failed` and `refund.needs-attention` events update `refund_status` (`none`, `pending`, `processing`, `processed`, `failed`, `needs_attention`), `refund_reference`, `refund_reason`, `refund_error`, the refund timestamps and `refunded_minor`. `refundable_minor` is what is left to refund. `paid_minor`, `paid_currency` and `provider_transaction_id` hold what Paystack reported for the original charge.

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
| `paystack-webhook` | The payment provider | Signed event receiver |
| `demo-checkout` | The demo checkout page | The demo provider's checkout backend. Answers 404 unless `PAYMENT_PROVIDER=mock`. Never deploy to production. |

`supabase/functions/_shared/payments/gateway.ts` defines `PaymentGateway`. Two classes implement it: `PaystackAdapter` (`paystack.ts`) and `MockPaymentGateway` (`mock.ts`). `factory.ts` picks one from `PAYMENT_PROVIDER`, which has no default: a function with it unset refuses to start rather than take demo payments by accident. Handlers use only the interface.

`PAYSTACK_SECRET_KEY` is a function secret and nothing else: it is never in the database, the browser bundle or an admin screen. Test or live mode is read from the key (`sk_test_` / `sk_live_`) and stored on each payment as `is_test`. `business_settings.online_payment_enabled` must be true for payments to start.

### Demo payments (the current mode)

Until the client's Paystack account is connected, the functions run with `PAYMENT_PROVIDER=mock`. Everything except the provider is real: holds, server-side amounts, `record_payment_result()`, idempotency, locks, schedule re-checks and refund flags behave exactly as they will with Paystack.

| Piece | What it does |
| --- | --- |
| `MockPaymentGateway` | Implements `PaymentGateway`. Speaks Paystack's formats (transaction objects, `charge.success` and refund events, HMAC-SHA512 signatures in `x-demo-signature`), so the same parsing and mapping code handles both. Always test mode. |
| `mock_provider.transactions` | The demo provider's ledger: plays Paystack's servers. Only reachable through `mock_provider_*` functions, which are server-only. |
| Demo checkout page (`?view=demo-checkout&reference=…`) | Plays Paystack's hosted checkout. The guest chooses: pay, declined card, pending bank transfer, or cancel. A testing option makes the provider send its notification twice. |
| `demo-checkout` function | Records the choice in the ledger, then delivers a signed `charge.success` to the real webhook handler in-process, as Paystack would. It never touches payments or appointments directly. |
| Confirmation page (`?view=payment-return&reference=…`) | The site's booking confirmation (see "Booking funnel"). The same page serves demo and real payments. |

Safeguards:

- Every page involved shows "Demo Payment — No real money will be charged." The flag comes from the server (`demo` in the `payments` responses), not from the browser.
- Demo payments are stored with `provider = 'mock'` and `is_demo = true`, and so are the appointments they create, so the demo purge removes them and reports can exclude them.
- The database refuses demo payments unless `business_settings.allow_demo_payments` is true. The column defaults to false; only the development seed turns it on. A production database therefore rejects demo payments even if a function were misconfigured.
- The demo webhook secret is derived from the project's service-role key, so the functions agree on it without another secret, and it never reaches the browser.

To use demo payments on a hosted development project: push the migrations, load the seed, deploy `booking`, `payments`, `paystack-webhook` and `demo-checkout`, set `PAYMENT_PROVIDER=mock`, `ALLOWED_ORIGINS` and `RATE_LIMIT_SALT` as function secrets, then run the site with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` pointing at that project and book through the "Book online" section.

### Future Paystack integration

No domain code changes: the switch is configuration plus one end-to-end test. Use the client's **test** keys first; switch to live keys only after the test run passes.

1. **Merchant account.** Confirm the client's Paystack account is approved for NGN card payments, and note whether test and live modes are both active.
2. **Secret key (server only).** In the Paystack dashboard, Settings > API Keys & Webhooks, copy the secret key (`sk_test_…` first, `sk_live_…` at launch). Set it as a function secret, never anywhere else:

   ```bash
   npx supabase secrets set PAYMENT_PROVIDER=paystack PAYSTACK_SECRET_KEY=sk_test_...
   ```

   The adapter refuses anything that is not a secret key and reads test or live mode from it; each payment records which mode it used in `is_test`.
3. **Webhook.** On the same Paystack page, set the webhook URL (one per mode) to:

   ```
   https://<project-ref>.supabase.co/functions/v1/paystack-webhook
   ```

   Paystack signs webhooks with the secret key itself, so there is no separate webhook secret to configure. Optionally restrict the function to Paystack's published webhook IP addresses.
4. **Deployment.** Deploy `booking`, `payments` and `paystack-webhook` (`npx supabase functions deploy booking payments paystack-webhook --use-api`). Do not deploy `demo-checkout` to production. Keep `ALLOWED_ORIGINS` set to the live site's origin and `RATE_LIMIT_SALT` set.
5. **Database settings.** `online_payment_enabled = true`, `allow_demo_payments = false`, and `payment_mode` / `deposit_percent` as the owner decides.
6. **Frontend.** Nothing to change: the `payments` function returns Paystack's hosted checkout address instead of the demo page, and `demo` becomes false, so the demo notice disappears. The return page is the same (`?view=payment-return`, or its Phase 4 equivalent).
7. **End-to-end test with real Paystack test mode.** With Paystack's test cards:
   - a successful card, confirmed through both `verify` and the webhook;
   - a declined card, then a retry;
   - a webhook redelivery from the Paystack dashboard, which must change nothing;
   - a payment completed after the hold expired;
   - a refund issued from the Paystack dashboard, recorded through the refund events.

   Compare the real response and event payloads with the simulated ones (`tests/support/fake-paystack.ts`) and update the adapter or the simulation if they differ. `tests/functions/gateway-contract.test.ts` then runs the same scenarios against both.
8. **Go live.** Replace the test key with the live key, register the live webhook URL, make one small real payment and refund it, and remove demo data with `supabase/snippets/purge_demo_data.sql`.

## Authentication and authorization

- Supabase Auth, email + password. Public sign-up is disabled: staff are invited, customers book as guests.
- A trigger creates a `profiles` row for every Auth user as an **inactive therapist**. Sign-up metadata can never set a role.
- RLS is enabled on every table. Access is decided by `private.staff_role()`, `private.is_admin()`, `private.is_owner()` and `private.therapist_id()`, which read the caller's **active** profile. Deactivating an account takes effect on its next request.
- The database decides everything. The staff app hides what a role cannot use, but only as a convenience: every rule below is enforced by grants, RLS or the staff functions, and is tested directly against the database.

| Who | Can do (Phase 5a) |
| --- | --- |
| Guest (`anon`) | Read 14 public tables (active services, therapists, zones, opening hours, settings, published content). Call one function, `get_available_slots`; holds and payments go through the Edge Functions. No access to the `private` schema, staff functions, customers, appointments, payments, holds or the audit log. |
| Signed in, no staff access (new or deactivated account) | Read their own profile; `staff_whoami()` reports why there is no access. Nothing else. |
| Therapist | Their own schedule, breaks and time off; their own appointments **only** through `therapist_agenda()` (booking contact name and phone, address, guest notes, booking notes, source, paid / deposit paid / to collect; no email, customer master record, staff notes, amounts or payment details; since 5b no direct read of the appointments table); mark their own started appointments completed or no-show; intake answers for those appointments (unused until Phase 6); blackout dates; their own name and phone. No direct writes. |
| Admin | Read appointments, customers, holds, payments, staff profiles and the audit log. All appointment and customer actions through the 5b functions (create phone/WhatsApp bookings, reschedule with rule override, cancel, outcomes and corrections, booking details, settlement, customer records). Schedules and the catalogue through the 5c functions (versioned, audited, conflict-checked); booking rules through `staff_update_booking_rules()`. Content and media (Phase 6). |
| Owner | Everything an admin can, plus inviting staff, staff roles and activation, linking therapist records to accounts, payment settings, and recording refunds made outside the system. |
| `service_role` (Edge Functions) | The only writer of `booking_holds`, `payments` and `payment_events`, so payment figures cannot be edited from the staff app. |

Nobody, from the app, can: write appointments, customers, profiles, business settings, opening hours, shifts, breaks, time off, closures, services, packages, therapists, therapist treatments or in-home areas directly (only through the functions below or the server); attach a provider payment to a phone or WhatsApp booking (a trigger refuses it, whoever asks); delete customers, services, therapists or dispatch zones (they are deactivated, decision H); change which account a therapist record belongs to except through `owner_link_therapist()`; change `allow_demo_payments` (no function exposes it; it is changed only in the SQL editor); edit or delete the audit log.

### Staff functions

All are `security definer` with a fixed `search_path`, executable by signed-in users only, and check the caller's role themselves. Every edit takes the version (`updated_at`) the screen was showing and fails with `stale_record` if the row has changed since; staff-account and settings changes need a reason (`reason_required`).

| Function | Who | Does |
| --- | --- | --- |
| `staff_whoami()` | any signed-in user | Profile, effective role, therapist record, session and required authentication level. Grants nothing. |
| `staff_update_own_profile(name, phone, version)` | any active staff | Own name and phone; never role or status. |
| `therapist_agenda(from, to)` | therapist | Own appointments in a range of up to 62 days. |
| `staff_update_booking_rules(version, reason, …)` | owner, admin | Business name, hold length, lead time, booking window, slot grid, buffer. Validated by the table's checks; applies to guests immediately. |
| `owner_update_payment_settings(version, reason, …)` | owner | Online payment on/off, full or deposit, deposit percent. |
| `owner_set_staff_role(profile, role, reason, version)` | owner | Change a role. |
| `owner_set_staff_active(profile, active, reason, version)` | owner | Activate or deactivate an account. |
| `owner_link_therapist(therapist, profile, reason, version)` | owner | Link a therapist record to an account (or unlink). |

Added in 5b (see "Appointment operations"): `staff_create_booking`, `staff_reschedule_appointment`, `staff_cancel_appointment`, `staff_set_appointment_status`, `staff_update_booking_details`, `staff_set_settlement`, `staff_create_customer`, `staff_update_customer`, and the reads `staff_appointments`, `staff_appointment_detail`, `staff_customer_directory`, `staff_customer_detail`, `staff_dashboard`, `staff_booking_options`. `therapist_agenda` was replaced with a version that adds booking notes, source and the version for outcome changes.

Added in 5c (see "Schedule and catalogue"): `staff_set_business_hours`, `staff_set_therapist_week`, `staff_add_time_off`, `staff_remove_time_off`, `staff_add_blackout`, `staff_remove_blackout`, `staff_save_service`, `staff_set_package_items`, `staff_save_therapist`, `staff_set_therapist_services`, `staff_save_zone`, and the reads `staff_schedule_overview`, `staff_catalogue`, `staff_schedule_conflicts`. `staff_dashboard` adds `schedule_conflicts`.

There is always at least one active owner: a trigger refuses to demote, deactivate or delete the last one (`last_owner`), whoever asks, and is serialised so two owners demoting each other at the same moment cannot both succeed.

Error codes the staff app explains: `not_authorized`, `stale_record`, `reason_required`, `invalid_profile`, `last_owner`, `not_found`, `invalid_range`, and from 5b `slot_unavailable` and `schedule_rule` (both with the rule in the error detail), `invalid_status`, `appointment_started`, `start_in_past`, `not_started`, `invalid_contact`, `invalid_customer`, `address_required`, `address_not_applicable`, `dispatch_zone_required`, `therapist_unavailable`, `email_in_use`, `invalid_source`, and from 5c `confirmation_required` (affected bookings as JSON in the error detail), `invalid_schedule`, `invalid_period`, `invalid_service`, `invalid_package`, `invalid_therapist`, `invalid_services`, `invalid_zone`, `slug_in_use`, `key_in_use`.

**Versions are passed back as received.** `updated_at` has microsecond precision; it must travel as the string the server sent (JSON keeps it). Converting it to a JavaScript `Date` drops the microseconds and every edit then fails as stale.

### Audit log

`audit_log` is append-only: no role, not even `service_role` or the table owner, can update, delete or truncate it (a trigger refuses; a future redaction routine is the only planned exception and is not built). Owner and admin can read it.

- **What is recorded.** Every insert, update and delete on the 14 staff-managed tables (profiles, therapists, therapist services, schedules, breaks, time off, blackout dates, business hours, business settings, services, package items, dispatch zones, customers, appointments), whoever makes it: staff, the booking server (`actor_kind = 'system'`) or the SQL editor. Staff functions add a named action (`staff.role_changed`, `settings.booking_rules_changed`, …) and the reason given. Holds and payments keep their own history (`payment_events`).
- **What is not.** New rows are recorded without their values. Updates record only changed columns (old and new), ignoring timestamps. Personal fields (customer name, email, phone and staff notes; appointment contact name, phone, address and notes; staff name and phone) are recorded as `{"changed": true}`, never with values; deleted rows keep only non-personal values. The list lives in `private.audit_personal_columns`. No table in the list holds passwords, tokens or payment credentials.
- **Room to grow.** `retention_class` and `redacted_at` are there for a future retention and redaction policy; nothing uses them yet.

### Two-factor readiness

Not enforced (decision K), but designed in. `private.auth_policy` holds the authentication level each role needs (`aal1` = password, `aal2` = password plus a second factor); all three start at `aal1`. Raising the owner's to `aal2`:

```sql
update private.auth_policy set required_aal = 'aal2' where role = 'owner';
```

makes `private.staff_role()` return nothing for an owner session without a second factor, so every policy and function denies it at once. `staff_whoami()` reports `session_aal` and `required_aal`, and the staff app already shows a separate "Extra verification needed" screen for that case. Turning it on later needs only the Supabase MFA enrolment and challenge screens there; the database and the rest of the app stay as they are.

### Storage

One public bucket, `site-media` (5 MB limit; JPEG, PNG, WebP, AVIF), with folders `services/`, `therapists/`, `gallery/`, `site/`. Only owner/admin can upload, replace or delete. Tables reference files through `media_assets`; the `image_url` / `photo_url` columns hold the current static paths until images are migrated.

## Frontend data layer

`src/lib/supabase.ts` creates the website's client from the two `VITE_` variables. It keeps **no login session**: nothing is stored, nothing refreshed, and login links in the address bar are ignored (decision M). `src/services/*` is the only website code that talks to Supabase:

- `catalogService`, `contentService`: public reads. They return the same shapes as `src/data.ts`, and fall back to that static content when Supabase is not configured.
- `bookingService`: guest availability (`getAvailableSlots`) and hold actions through the `booking` function. Failures throw `BookingError` with the codes above.
- `paymentService`: `startPayment` and `verifyPayment` through the `payments` function. Only a `confirmed` outcome from `verifyPayment` means a booking exists. The `*DemoCheckout` functions drive the demo checkout page.

The website stores nothing in `localStorage`. The old booking form's `everest_bookings` key is deleted on every page load (`src/booking/legacyStorage.ts`). `sessionStorage` (this tab only) holds two conveniences: the reserved-time token for retrying a failed payment (`smm_payment_<reference>`, removed once the outcome is final) and whether the floating shortcut was dismissed.

## Staff app

`/staff/` (`staff/index.html`, code in `src/staff/`) is a separate Vite entry and bundle: the website loads none of its code. The page is marked `noindex`.

| Piece | File | Role |
| --- | --- | --- |
| Client | `lib/client.ts` | Its own Supabase client: session stored under `smm-staff-auth`, refreshed automatically, invite and reset links read from the address bar (implicit flow, because invite links are generated on the server). Created on first use, after `main.tsx` has noted the link type. |
| Server access | `lib/backend.ts` | The `StaffBackend` interface and its Supabase implementation; `accessFor()` turns `staff_whoami()` into what to show; `messageFor()` turns error codes into plain messages. |
| Links | `lib/authLink.ts` | Recognises invite, recovery and expired links in the fragment. |
| Screens | `StaffApp.tsx`, `StaffShell.tsx`, `screens/` | Sign in, forgot password, set password (invite and reset), account not active, extra verification needed, the signed-in shell, My account. |
| Sections | `sections.ts`, `router.ts` | Which sections each role sees; `#/<section>/<id>?<params>` routing. Owner/admin: Today, Bookings, Customers (5b), Schedules and Services & therapists (5c), and placeholders for 5d; therapist: My agenda and My account. |
| Operations | `lib/ops.ts`, `screens/` | The 5b data layer (one database function per call) and screens: `HomeScreen`, `BookingsScreen`, `AppointmentDetailScreen`, `NewBookingScreen`, `CustomersScreen`, `AgendaScreen`. Times are shown and entered in the business timezone. |

Coming back to the tab re-checks access (`staff_whoami`) at most every 15 seconds, as do token refreshes; a failed background check leaves the screen as it is. This only updates what the app shows: the database refuses a deactivated or demoted account on its very next request either way.

Sign-in errors never say whether an account exists, and the reset form always gives the same reply. Passwords must be at least 10 characters (match the project's Auth setting). Reset and invite emails must redirect to `https://<site>/staff/`, which has to be in the project's Auth redirect URLs. Invites will be sent by an owner-only Edge Function (decision J, later checkpoint); until then, invite from the Supabase dashboard.

## Appointment operations (Phase 5b)

Migration `20261011000100_staff_appointment_operations.sql`.

**Source and settlement (decision C).** Every appointment has `source` (`online`, `phone`, `whatsapp`) and `settlement` (`online_payment`, `pay_at_venue`, `paid_offline`). A check constraint ties them: only online bookings are settled by online payment. A trigger on `payments` refuses to attach any payment to a booking that is not settled online, so staff bookings can never appear in, or alter, the provider-verified ledger. Phone and WhatsApp customers may have no email (a customer needs an email or a phone).

**Phone/WhatsApp bookings** (`staff_create_booking`) go through `request_booking_hold`, the same function, rules, therapist locks and overlap safeguards as an online booking, under the shared schedule-rules lock, and are then confirmed directly with `created_by` and the reason recorded. No scheduling rule can be overridden at creation. A new guest whose email is on file is linked to that customer without changing the record.

**Rescheduling** (`staff_reschedule_appointment`, owner/admin) takes the schedule-rules lock (shared), then both therapists' locks in id order, then the appointment row, then checks the version. Overlap with any other booking or live guest hold is never allowed. A failed scheduling rule (notice, window, grid, hours, blackout, shift, break, time off) is refused with `schedule_rule` and the rule name, unless `p_override` is set; the override and the rule are recorded in the audit entry. The therapist must offer the treatment (not overridable). Bookings that have started, ended or been cancelled cannot be moved.

**Cancellation** (`staff_cancel_appointment`, owner/admin) needs a reason and frees the time at once. An online payment linked to the booking is flagged `needs_refund` with reason `appointment_cancelled`; nothing is refunded. A booking paid offline is not touched by the ledger; staff arrange any refund directly.

**Outcomes** (`staff_set_appointment_status`): completed or no-show once the appointment has started, by its own therapist or owner/admin. Corrections (between completed, no-show and back to confirmed) are owner/admin only, with a reason; going back to confirmed is refused if the time has been booked since.

**Booking contact versus customer record.** `staff_update_booking_details` changes the contact name and phone, the in-home address and the booking notes of one booking; `staff_update_customer` changes the customer master record. Neither touches the other. Customer records are no longer writable directly, only through these versioned, audited functions.

Audit actions: `appointment.created_by_staff`, `appointment.rescheduled`, `appointment.cancelled` (with any flagged payment ids), `appointment.completed`, `appointment.no_show`, `appointment.status_corrected`, `appointment.details_updated`, `appointment.settlement_changed`, `customer.created`, `customer.updated`. Booking notes join the personal fields recorded only as changed.

## Schedule and catalogue (Phase 5c)

Migration `20261012000100_staff_schedule_catalogue.sql`.

**One rule set.** `private.schedule_block_reason()` holds the opening-hours, closure, shift, break and time-off checks. `private.slot_block_reason()` (availability, holds, staff bookings, rescheduling and the payment re-check) calls it, with the same checks in the same order as before, and conflict detection uses it too.

**Every change goes through a function** (owner/admin) that:

1. takes the schedule-rules lock exclusively, before anything else; guest reservations, payments, staff bookings and reschedules hold it shared, so they either finish before the change (and are counted in its warning) or see it;
2. checks the version the screen showed (`updated_at` for services, therapists and areas; a fingerprint of the rows for opening hours, a therapist's week, a therapist's treatments and a package's contents);
3. makes the change, labelled for the audit log;
4. compares conflicts before and after. If the change puts any future booking in conflict, or would make a live guest reservation unpayable, it is refused with `confirmation_required` and the affected bookings, unless it is sent again with `p_confirm` and a reason. The acceptance is audited as `schedule.conflicts_accepted` (booking ids and reasons only, no names).

**Conflicts are never resolved by cancelling.** No schedule or catalogue function writes appointments, holds or payments. A future booking is in conflict when it is outside opening hours, in a closure, outside its therapist's shift, in a break or time off, or its treatment, therapist or in-home area is inactive, or its therapist no longer offers the treatment. Conflicts are listed in Schedules › Conflicts and counted on the Today screen; a booking leaves the list as soon as nothing conflicts with it. Booking-time rules (notice, booking window, grid) apply only when booking, so they never make an existing booking a conflict.

**Bookings keep what they were booked with.** Price, travel fee, length and buffer are copied onto each booking (and onto a payment when it starts), so catalogue changes never alter them. A guest who is mid-payment for a treatment whose length or buffer then changes, or whose time becomes unavailable, is refused at the payment re-check and the payment is flagged for refund (Phase 3 behaviour); such reservations are counted in the warning.

**Deactivate, never delete.** Treatments, therapists and areas are deactivated; they stay on existing bookings and in history. Time off and closures are removed (removal only frees time). Package contents and the treatments a therapist offers are replaced as a whole.

Audit actions: `schedule.hours_changed`, `schedule.therapist_week_changed`, `schedule.time_off_added` / `_removed`, `schedule.blackout_added` / `_removed`, `schedule.conflicts_accepted`, `catalogue.service_created` / `_updated`, `catalogue.package_items_changed`, `catalogue.therapist_created` / `_updated`, `catalogue.therapist_services_changed`, `catalogue.zone_created` / `_updated`. Time-off notes are recorded only as changed (they may concern health).

## Payments, refunds, staff and audit (Phase 5d)

Migration `20261013000100_staff_payments_staff_audit.sql` and Edge Function `staff-invite`.

**Payments are read-only for staff.** Owner and admin see a payments list (filters: refund needed, all, paid, in progress, failed, abandoned, refunded), each payment's booking or reservation, guest, refund records, provider messages received (type and timing only, never their content) and history. Payments are now audited like other tables, so the history shows every status and refund change made by the server. The checkout address is never shown and is recorded in the log only as changed.

**Refunds are recorded, never sent (Decision D).** Only the owner records a refund made outside the system (`owner_record_refund`): amount, method, optional reference and note, and a reason, against the payment's current version.

- **Bank transfer or cash:** the payment's refunded amount and status change in the same transaction, capped at what was received; the refund flag clears when nothing is left to refund.
- **Via the provider's dashboard:** recorded as requested only (refund status `pending`); amounts change when the provider's own refund event arrives (`record_refund_event`), so nothing is counted twice.

`refund_records` is append-only for everyone, including the server and the table owner. Notes are audited only as changed. Bookings are never changed by a refund record.

**Staff accounts (owner only).** The staff list shows each account's email, role, access and therapist link. Invitations go through the `staff-invite` Edge Function: it asks the database, with the caller's own token, whether they are an active owner (`staff_whoami`), limits each owner to 20 invitations an hour, sends Supabase Auth's own invitation email (the link opens `/staff/` to choose a password), and records `staff.invited` as the owner (no email in the log). The new account has no access until the owner gives it a role and activates it. Role, access and therapist link use the 5a functions, each with a reason and the record's version; the last active owner stays protected.

**Settings.** Owner and admin can rename the business; payment settings (online payment on or off, full or deposit, deposit %) are owner-only. `allow_demo_payments` is shown read-only; no function can change it. Provider keys never appear in the staff app.

**Activity log.** Owner and admin read the audit log by area (bookings, customers, payments and refunds, schedules, catalogue, staff accounts), newest first, with links to records. Entries cannot be changed or deleted by anyone; personal fields show only that they changed.

**Not in Phase 5:** Paystack itself, matching payments against Paystack's records, refunds through the Paystack API, disputes.

## Phase 5e integration

No new features. One integration defect was fixed: a guest whose paid booking was cancelled by staff was still told "Your booking is confirmed" on the confirmation page. The payment outcome (`private.payment_outcome`, migration `20261014000100_guest_outcome_cancelled.sql`) now reports `cancelled` for a paid booking that has been cancelled; the `payments` function treats it as final, and the confirmation page says the booking was cancelled and that any refund due will be arranged.

Added checks: a security snapshot of what every role can reach, a whole-system test (a guest books and pays through the website's services, staff then reschedule, cancel and record the refund through the staff client), and a mixed real-PostgreSQL stress race. The security review is in [PHASE-5-SECURITY-REVIEW.md](PHASE-5-SECURITY-REVIEW.md).

**Deployment requirements recorded for later (not configured):** `STAFF_APP_URL` for `staff-invite`; the staff app's address in `ALLOWED_ORIGINS`; custom SMTP for invitation emails; Auth redirect URL `/staff/`; minimum password length 10.

## Booking funnel

The "Book online" section (`#booking`) is the funnel; `src/booking/` holds all of it.

| Piece | File | Role |
| --- | --- | --- |
| State machine | `funnel.ts` | Steps, guards, hold invalidation and release, expiry, display-only price estimate, details validation. No network, no React. |
| Controller | `useBookingFunnel.ts` | Connects the state machine to `bookingService` and `paymentService`: availability, then hold, then details, then payment. |
| Catalogue | `useBookingCatalog.ts`, `useSiteCatalog.ts` | What the funnel and the site's cards need from the database; static content when it is unavailable. |
| Screens | `components/` | `BookingSection` (loading, unavailable, error, funnel), `BookingFunnel`, the five steps, `HoldTimer`, `BookingSummary`. |
| Confirmation | `BookingConfirmationPage.tsx` | Served at `?view=payment-return&reference=…`, the address the checkout returns to: confirmed, pending (re-checks automatically), failed (retry), refund required. |
| Routing | `src/routes.ts`, `src/AppRouter.tsx` | `?view=payment-return` and `?view=demo-checkout`; everything else is the website. Query parameters need no hosting rewrites. |

How it connects to the rest of the site:

- The service and package "Book" buttons preselect that treatment in the funnel and move focus to the booking heading. Any time already reserved for another treatment is given back.
- The floating "Spa Appointments" button scrolls to the funnel (Calendly is gone). It hides while the booking section is on screen.
- Going to the booking section, or using the funnel, closes the WhatsApp chat panel, through the hand-off event in `src/components/widgetEvents.ts` that the Calendly popup used before. The WhatsApp widget itself is unchanged.
- With no backend, no catalogue or business settings, or online payment switched off, the section shows "Online booking is unavailable right now" with WhatsApp and phone links. The rest of the site renders normally from its static content.

Trust boundary, unchanged from Phases 2 and 3: the funnel sends only choices (treatment, place, therapist, time, contact details). Prices before payment are labelled estimates; the amount at payment is the server's. The browser never creates appointments or decides that a payment succeeded. The confirmation page shows only what the server's verification returns.

### Demo and real payments in the funnel

| | Demo (now) | Real (later) |
| --- | --- | --- |
| Server setting | `PAYMENT_PROVIDER=mock` | `PAYMENT_PROVIDER=paystack` plus `PAYSTACK_SECRET_KEY` |
| Checkout the guest is sent to | The site's demo checkout (`?view=demo-checkout`) | Paystack's hosted checkout |
| "Demo Payment — No real money will be charged." | Shown on review, demo checkout and confirmation | Never shown (the server reports `demo: false`) |
| Pay button | "Continue to demo payment" | "Pay securely" |
| Return address and confirmation page | Same | Same |

### Deferred to Phases 5 and 6

Not part of the funnel, by decision:

- Customer accounts, and guest self-service cancel or reschedule. The confirmation asks guests to message or call.
- Intake questions (moved to Phase 6, decision N; Phase 5 collects no intake or health data).
- Staff screens for payments, staff accounts, settings and the activity log (Phase 5d).
- CMS editing; FAQs, gallery and testimonials from the database; analytics (Phase 6).
- Email, SMS and WhatsApp confirmations and reminders.
- Refund initiation.
- An offline "bank transfer then send proof" payment path.

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
| `tests/db/payments-concurrency.test.ts` | Payment races on real PostgreSQL: duplicate webhooks, webhook against verify, late payment against a new guest, rule changes in progress |
| `tests/db/payment-schedule.test.ts` | Each scheduling rule changed after a hold: the paid hold is refused with the rule named; unrelated changes and time passing are not |
| `tests/functions/gateway-contract.test.ts` | The same payment scenarios against both gateways (Paystack adapter and demo gateway): proves the demo exercises the same invariants |
| `tests/functions/demo-checkout.test.ts` | The demo checkout backend, the opt-in switch, the provider selection, and the demo provider's access boundary |
| `tests/e2e/booking-payment-prototype.test.ts` | The booking and payment services over HTTP (`tests/support/local-backend.ts`), plus page routing |
| `tests/db/mock-payments-concurrency.test.ts` | Demo-payment races on real PostgreSQL |
| `tests/booking/*.test.ts` | The funnel state machine, the controller hook, the catalogue hook, Lagos-time calendar helpers |
| `tests/booking/components/*.test.tsx` | Every funnel step, keyboard-only booking, 409 and 410 handling, the countdown, the demo notice, the unavailable state, every confirmation outcome (jsdom and Testing Library) |
| `tests/site/site-without-backend.test.tsx` | The whole website with no backend: static fallback, legacy form and My Bookings gone, `localStorage` clean-up, "Book" and floating buttons, WhatsApp hand-off, routing |
| `tests/site/site-with-backend.test.tsx` | The whole website against the real handlers and database: every booking scenario through to the confirmation page |
| `tests/db/staff-authorization.test.ts` | The Phase 5a role matrix: every staff function against guest, new account, inactive admin, therapist, admin and owner; refused direct writes; last owner; versions and reasons; two-factor policy; therapist agenda |
| `tests/db/staff-audit.test.ts` | Audit coverage, actions and reasons, no personal values in the log, append-only, who can read it; guests' exact privileges (tables, functions, `private` schema) |
| `tests/db/staff-concurrency.test.ts` | Staff races on real PostgreSQL: owners demoting or deactivating each other, two edits from the same version |
| `tests/staff/staff-backend.test.ts` | The staff app's real Supabase client and adapter over HTTP against the database functions |
| `tests/staff/StaffApp.test.tsx` | Staff screens: sign-in, role navigation, no-access and verification screens, invite/reset/expired links, My account |
| `tests/db/staff-appointments.test.ts` | 5b: every new function against guest, new account, inactive admin, both therapists, admin and owner; phone bookings (rules, overlaps, ledger separation, customer linking); rescheduling and overrides; cancellation and refund flags; outcomes; contact versus customer record; settlement; therapist data minimisation; reads; audit of every staff action |
| `tests/db/staff-appointments-concurrency.test.ts` | 5b races on real PostgreSQL: phone booking against guest holds and late payments, reschedule against holds and payments, two staff on one booking, cancellation against payment replays, refunds and new holds |
| `tests/staff/screens.test.tsx` | Every 5b screen against a scripted backend: what it shows, what it sends, how it reports refusals |
| `tests/staff/staff-operations.test.ts` | The staff data layer over HTTP against the real 5b functions, for owner/admin and therapist |
| `tests/db/staff-schedule-catalogue.test.ts` | 5c: every function against every role; no direct writes; conflicts for closed days, shifts, time off, closures, deactivations, removed treatments and areas; confirmation and its audit; booked prices, fees and lengths unchanged; package and version checks |
| `tests/db/staff-schedule-concurrency.test.ts` | 5c races on real PostgreSQL: time off against guest holds, payments and reschedules; closures, shift changes, deactivations against staff bookings; duration change against a payment; two week edits from one version |
| `tests/staff/schedule-catalogue-screens.test.tsx` | The Schedules and Services & therapists screens, including the confirm-with-reason flow |
| `tests/db/staff-payments-staff.test.ts` | 5d: every function against every role; no direct writes to payments, events, refund records, profiles or settings; payment visibility (no checkout address or event payloads); refund recording by method, caps and refusals; append-only refund records; staff list, invitation record, activation and deactivation, last owner; settings; audit viewer |
| `tests/db/staff-payments-concurrency.test.ts` | 5d races on real PostgreSQL: two owners refunding one payment, cash refund against a provider refund event, refund against cancellation, refund against payment replay, two owners changing one account, deactivation during a staff action, owners deactivating each other |
| `tests/functions/staff-invite.test.ts` | The invitation function: owner only, validation, duplicates, rate limit, CORS, audit |
| `tests/staff/payments-staff-screens.test.tsx` | Payments, refund recording, staff accounts, settings and activity log screens |
| `tests/db/security-snapshot.test.ts` | 5e: the exact functions each role can call, server-only functions, no default execute grants, every staff function checks the role itself, RLS on every table, the only directly writable tables, no secret columns |
| `tests/db/phase5-mixed-concurrency.test.ts` | 5e: guest reservations, phone booking, reschedule, time off, payment completion, cancellation and refund racing together on real PostgreSQL, with system-wide invariants |
| `tests/e2e/guest-to-staff.test.ts` | 5e: a website booking handled by staff end to end, and what the guest is told throughout |
| `tests/staff/client-separation.test.ts` | The website's client keeps no session and ignores login links; separate storage keys; no staff imports or secrets in the website |

The local test backend (`tests/support/local-backend.ts`) serves the real Edge Function handlers and the database's REST reads and RPC calls over HTTP, so the site's own code can be tested end to end without Docker or a Supabase account. Given a `staffPassword`, it also stands in for Supabase Auth (password sign-in with unsigned test tokens) and runs RPC calls as the signed-in user.

Layout at 360, 768 and 1280 px was checked in headless Microsoft Edge against the integrated site (no horizontal scroll, no covered controls, sticky summary behaviour, focus placement). That check is not part of `npm test`.

Limits: Supabase Auth itself (login, password reset emails), real Storage uploads, the Deno entry point `index.ts`, the pg_cron schedule and PostgREST's handling of the RPC calls are not covered; check those against a local or hosted Supabase project.

## Open issues carried forward

Decide or fix these in the booking-funnel and payment phases:

- **Mobile travel time.** A mobile appointment blocks only the service duration and the normal turnover buffer; no extra travel time is reserved. Needs the client's input.
- **Payments are simulated.** The site runs on the demo gateway. The Paystack adapter has only been tested against a simulated Paystack built from its documentation; follow "Future Paystack integration" before go-live.
- **Edited details after payment starts.** If a guest goes back and changes their details after payment has started, the booking gets the new name and phone, but the already-open payment keeps the original email.
- **No favicon.** The site has no `favicon.ico`, so browsers log a 404 (pre-existing).
- **Public-site colour contrast (found in 5e, pre-existing).** An automated accessibility scan of the booking section and confirmation page found two contrast problems, neither from Phase 5: the original site's gold eyebrow labels (`#f4c430` on cream, 1.5:1; the same style is used across the site) and the Phase 4 funnel's grey helper text on beige panels (`#8a6a5e` on `#f5f1eb`, 4.3:1, just under 4.5:1). Left unchanged pending a decision, because the public site's look was fixed for Phases 4-5.
- **Refunds are manual.** Payments flagged `needs_refund` must be refunded by the owner in the Paystack dashboard; the resulting Paystack events update the record. Nothing alerts staff to a flagged payment until the Phase 5 dashboard exists.
- **Several partial refunds.** Each payment stores one refund reference and a running total; a per-refund history table is left for the refund workflow.
- **Deposit balances.** A deposit confirms the booking; collecting the remainder is not handled online.
- **Rule changes and unpaid holds.** Resolved in 5c: creating a hold (`request_booking_hold`) takes the schedule-rules lock (shared), so a reservation and a rule change never straddle each other. A hold made before a change that rules it out is still refused at payment and the payment flagged for refund.
- **Price changes after payment starts.** The price is fixed when payment starts; a later catalogue price change does not affect that booking.
- **Direct database access is a separate, privileged trust boundary.** Everything in this guide about who may do what applies to the app and the API. Anyone with direct SQL access (the Supabase SQL editor, the database password, the service-role key, a Supabase dashboard login) works outside it and must be limited to the owner and trusted operators. One example: the named action and reason on an audit entry come from transaction settings that staff functions set; someone with direct SQL access could set them by hand (the actor recorded is still accurate). Through the API, signed-in users cannot set them.
- **Staff session checks.** The staff app re-checks access on sign-in, on token refresh (about hourly) and when the tab regains focus (at most every 15 seconds). The database refuses a deactivated account at once; the app may show its screens until the next check.
- **A guest's own hold hides its slot (server side).** The availability listing shows a held time as taken, including to the guest holding it. The funnel adds it back as "Reserved for you"; other clients of the API would need to do the same.
- **Rate limiting is per IP address.** Visitors sharing one network share a limit. The limits are constants in `supabase/functions/booking/handler.ts`.
- **`embedded-postgres` is a development/test-only dependency.** It downloads PostgreSQL binaries and is never part of the deployed site.
- **Site content.** The live page still shows testimonials with realistic names, therapist star ratings and a street address that the client has not verified.
- **Paystack eligibility.** The client's merchant account has not been confirmed.
- **Intake data retention.** Access is restricted by RLS, but nothing deletes intake answers automatically.

## Phase 5b decisions and limits

- **No overrides for phone bookings.** They follow the same rules as online bookings, so a call less than the minimum notice before the time cannot be booked; book it for a later time, or reschedule with an override afterwards.
- **Who may override.** Owner and admin may override scheduling rules when rescheduling.
- **Paid offline.** No amount is recorded for offline payments; the booking's price is the reference. Refunds for offline payments are arranged outside the system.
- **Timezone.** The staff app shows and takes times in the business timezone (Africa/Lagos), whatever the device's.

## Phase 5c decisions and limits

- **Hardening (migration `20261012000200_schedule_hardening.sql`).** Guest reservations take the schedule-rules lock (shared) before deciding, so they are serialised with schedule and catalogue changes. The payment re-check also requires an in-home booking's area to be active; otherwise no booking is made and the payment is flagged `zone_unavailable`. Both functions are otherwise unchanged.
- **Booking rules never create conflicts.** Minimum notice, booking window, grid and hold length affect new bookings only.
- **Overridden reschedules stay listed.** A booking moved with a rule override remains in Conflicts while the rule it overrode applies.
- **One shift and one break per day in the screens.** The database allows more; the weekly editor shows and saves one of each.

## Phase 5d decisions and limits

- **Provider-dashboard refunds wait for the provider.** With the demo provider there are no refund events, so such records stay "requested"; record demo refunds as bank transfer or cash.
- **No tamper-evident chain on the audit log.** Entries are append-only for every role, but not hash-chained: chaining would make every audited write (including guest bookings and payments) wait on one lock.
- **Invitations cannot be re-sent from the app** once an account exists; the owner can reset the password from the Supabase dashboard, or the person can use "Forgot your password".
- **Moving a therapist link is two steps** (unlink, then link), each audited.

## Going to a hosted Supabase project

1. Create the project, then `npx supabase link --project-ref <ref>` and `npx supabase db push`. Do **not** run `seed.sql` there.
2. In Authentication settings: disable sign-ups, set the Site URL and redirect URLs (including `https://<site>/staff/`), minimum password length 10. Invite emails need custom SMTP before staff invites are used. (`supabase/config.toml` only configures the local stack.)
3. Invite the owner from Authentication > Users, then promote them once in the SQL editor:

   ```sql
   update public.profiles set role = 'owner', is_active = true
   where id = (select id from auth.users where email = 'owner@their-domain');
   ```

4. Deploy the functions and their secrets: `npx supabase functions deploy booking payments paystack-webhook staff-invite --use-api`, then `npx supabase secrets set ALLOWED_ORIGINS=https://<site> RATE_LIMIT_SALT=<random> PAYMENT_PROVIDER=paystack PAYSTACK_SECRET_KEY=sk_test_...`. Confirm the `booking-maintenance` job exists under Integrations > Cron. For `staff-invite`, also set `STAFF_APP_URL=https://<site>/staff/` and add the staff app's origin to `ALLOWED_ORIGINS`; configure custom SMTP so invitation emails are delivered. Payment setup is covered step by step in "Future Paystack integration".
5. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel. The service-role key is not needed by the site.
6. Regenerate types once the project exists: `npx supabase gen types typescript --linked > src/lib/database.types.ts`.
