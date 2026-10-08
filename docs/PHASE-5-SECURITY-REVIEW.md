# Phase 5 security review

Scope: the staff application and everything it touches (Phases 5a–5e), reviewed against the guest booking and payment system built in Phases 1–4. State at the Phase 5e checkpoint, before any hosted deployment. Every claim below is backed by an automated test; the test file is named in brackets.

## 1. Trust boundaries

| Boundary | Who is on each side | What enforces it |
| --- | --- | --- |
| Guest ↔ database | Anyone on the internet ↔ data | The `anon` role can read 14 public catalogue/content tables and call one function, `get_available_slots`. Holds and payments go through the Edge Functions, which validate and rate-limit. [security-snapshot, staff-audit] |
| Staff ↔ database | A signed-in user ↔ data | Grants (no direct writes to bookings, customers, payments, schedules, catalogue, profiles or settings), row level security on every table, and 43 staff functions that each check the caller's role, active state and the record's version. [security-snapshot, staff-authorization, staff-appointments, staff-schedule-catalogue, staff-payments-staff] |
| Owner ↔ admin ↔ therapist | Staff roles | Checked inside each function (`private.require_staff`), never by the screen. Owner only: staff accounts and invitations, roles and access, therapist links, payment settings, refund records. Therapists: their own agenda and outcomes only. |
| Server code ↔ everyone | Edge Functions (service key) ↔ users | 18 booking/payment functions are executable by server code only. The service key exists only in the function environment. The `staff-invite` function uses it only after the database, asked with the caller's own token, confirms an active owner. [security-snapshot, staff-invite] |
| Website session ↔ staff session | Public site ↔ `/staff/` | Separate bundles and Supabase clients. The website client stores no session and ignores login links; the staff client uses its own storage key. [client-separation] |
| Direct database access | Supabase dashboard, SQL editor, database password, service key ↔ the app | **Outside the app's controls.** Must be limited to the owner and trusted operators (see section 6). |

## 2. Authentication

- Supabase Auth, email and password; public sign-up is disabled. A new account (invited or otherwise) starts as an inactive therapist and has no staff access until the owner activates it; sign-up metadata can never set a role. [staff-payments-staff, foundation]
- Deactivation takes effect on the very next database request; the staff app also re-checks on token refresh and when the tab regains focus. [staff-authorization, StaffApp]
- Sign-in and password-reset messages never reveal whether an account exists. Passwords must be at least 10 characters (to be matched by the hosted Auth setting).
- Two-factor sign-in is designed in but not enforced (Decision K): `private.auth_policy` can require it per role, and every policy and function then refuses sessions without it. [staff-authorization]
- There is always at least one active owner, even when two owners demote or deactivate each other at the same moment. [staff-concurrency, staff-payments-concurrency]

## 3. Data exposure

| Data | Owner / admin | Therapist | Guest |
| --- | --- | --- | --- |
| Customer master records (name, email, phone, staff notes) | Read; edit via versioned functions | Never | Never |
| Booking contact, address, guest and booking notes | Read; edit via functions | Own appointments only, through `therapist_agenda` | Their own outcome only (reference and time) |
| Payments | Read only (never the checkout link or provider message contents) | "Paid / deposit paid / to collect" only | Their own outcome |
| Provider messages (`payment_events`) | Type and timing only | No | No |
| Audit log | Read | No | No |
| `allow_demo_payments` | Shown, never changeable | No | No |
| Provider keys, service key | Never stored in the database or shown anywhere | — | — |

No column in the database holds a password, secret or provider key. [security-snapshot]

## 4. Integrity

- **Bookings cannot overlap**, whoever creates or moves them: exclusion constraints and guard triggers, the therapist locks, and (since 5c) the schedule-rules lock taken by guest reservations, staff bookings, reschedules, payments and schedule changes in a fixed order. [concurrency, staff-appointments-concurrency, staff-schedule-concurrency, phase5-mixed-concurrency]
- **Money is never lost or invented:** every received payment is either attached to a booking or flagged for refund; no failed payment creates a booking; refunds never exceed what was received; phone and WhatsApp bookings can never be attached to a provider payment (database trigger). [payments, mock-payments-concurrency, staff-payments-concurrency, phase5-mixed-concurrency]
- **Refunds are recorded, never sent.** Bank transfer and cash records change the refunded amount; "via provider dashboard" records only the request and leaves amounts to the provider's own refund event, so nothing is counted twice. Refund records are append-only for every role. [staff-payments-staff]
- **Schedule and catalogue changes never touch existing bookings or started payments.** Conflicts are listed, and a change that creates new ones must be confirmed with a reason. [staff-schedule-catalogue, staff-schedule-concurrency]
- **Stale edits are refused** everywhere a screen edits a record (`updated_at` or a fingerprint of the rows). [all staff test files]

## 5. Audit

- Triggers record every change to the 16 staff-managed tables (bookings, customers, payments, refund records, staff accounts, therapists and their links, all schedule and catalogue tables, settings), whoever makes it; staff functions add a named action and the reason. Booking system changes are recorded as "system". [staff-audit, staff-appointments, staff-schedule-catalogue, staff-payments-staff]
- Personal fields are recorded only as "changed": customer details and staff notes, booking contact, address and notes, staff names and phones, time-off notes, refund notes, the checkout link. No password, token or payment credential is ever recorded.
- The log is append-only for every role including the server and the table owner. It is not hash-chained (approved: a chain would serialise every audited write, including guest bookings).

## 6. Findings and residual risks

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | A guest whose paid booking was cancelled by staff was still shown "Your booking is confirmed" on their confirmation page. | Medium (misleading) | **Fixed in 5e** (`20261014000100_guest_outcome_cancelled.sql`): the outcome reports "cancelled". [guest-to-staff, BookingConfirmationPage] |
| 2 | Some staff functions check that a reason was given before checking the caller's role, so a signed-in user without access who omits the reason gets "reason required" instead of "not authorised". Nothing is changed or revealed either way. | Low | **Fixed** after 5e (`20261015000100_role_before_reason.sql`): the role is checked first in all ten functions. [staff-authorization-order] |
| 3 | The website content and intake tables (FAQs, testimonials, gallery, media, site content, announcements, intake questions and answers) are still writable directly by owner/admin under their Phase 1 policies, without audit labels. Not used by the staff app. | Low | **Phase 6 task (accepted):** move them behind audited server-side functions with authorization, RLS and tests; the staff app must not gain direct write access. [security-snapshot pins the list] |
| 4 | Anyone with direct database access (dashboard, SQL editor, database password, service key) is outside every control above, including audit labels. | Inherent | Operational: limit to the owner and trusted operators; rotate keys when people leave. |
| 5 | Not yet run against hosted Supabase: Auth, PostgREST and the Edge runtime are stood in for locally in tests. | — | Hosted validation is a later, approved checkpoint. |
| 6 | Invitation emails depend on Supabase Auth email delivery. | — | Configure custom SMTP before use (deployment checkpoint). |

## 7. Before going live (deferred, not configured)

- Push migrations and deploy the Edge Functions, including `staff-invite`, to the hosted project.
- `staff-invite`: set `STAFF_APP_URL` (`https://<site>/staff/`) and add the staff app's origin to `ALLOWED_ORIGINS`.
- Auth: custom SMTP, minimum password length 10, redirect URL `https://<site>/staff/`, sign-ups disabled.
- Keep `allow_demo_payments` off in production; real Paystack only after the integration checkpoint.
- Invite the owner, promote them once in the SQL editor, and review who holds dashboard and key access.
