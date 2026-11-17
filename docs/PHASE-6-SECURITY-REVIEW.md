# Phase 6 security review

Scope: website content management (Phases 6a–6c): the content tables and their staff functions, the `staff-media` upload function, the staff app's Website section, and the public site reading that content. Reviewed against the Phase 5 review (`PHASE-5-SECURITY-REVIEW.md`), which still holds for everything else. The intake questionnaire (6d) is deferred until after launch and is not covered.

State at the Phase 6e checkpoint (18 November 2026). Every claim below is backed by an automated test, named in brackets, or by a check run against the hosted `smm-dev` project, marked [hosted].

## 1. Trust boundaries (additions to Phase 5)

| Boundary | Who is on each side | What enforces it |
| --- | --- | --- |
| Guest ↔ website content | Anyone ↔ FAQs, testimonials, gallery, announcements, site content, media | Row level security: published rows only; announcements only while in date; a media row only while a published gallery item, active treatment or active therapist uses it. Column grants: only the columns the site shows (no `is_demo`, `updated_by`, descriptions, timestamps). No write grant of any kind. [content-security, content-service, content-to-site, hosted] |
| Staff ↔ website content | Owner/admin ↔ the six content tables | No direct writes for anyone (owner included). 12 staff functions, each checking the role first, then the record's version; new items start hidden; publishing, reordering and deleting are separate, audited actions; a published item cannot be deleted; deleting needs a reason. Therapists are refused. [content-functions, content-concurrency, staff-operations, security-snapshot, hosted] |
| Staff ↔ file storage | Owner/admin ↔ the `site-media` bucket | Staff have no Storage policies. Uploads and removals go through the `staff-media` Edge Function, which asks the database who the caller is with the caller's own token, reads the file's real type from its bytes (JPEG, PNG, WebP or AVIF only; never SVG or HTML), limits it to 5 MB and 60 uploads an hour, stores it under a generated name, and registers it as the caller. A file in use cannot be removed. [staff-media, content-functions, hosted] |
| Website ↔ content it shows | Database text ↔ visitors' browsers | Everything is rendered as plain text by React; there is no `dangerouslySetInnerHTML` anywhere in `src/`. Gallery pictures are either uploaded files (served from Storage) or files shipped with the site: the database refuses any other address (`/assets/...` only). [site-content, content-functions] |

## 2. Data exposure

| Data | Owner / admin | Therapist | Guest |
| --- | --- | --- | --- |
| Published FAQs, gallery, reviews, announcements, contact details | Read and edit through functions | Never | Read (text columns only) |
| Hidden (unpublished) items, the hidden homepage heading | Read and edit | Never | Never |
| Who changed what, demo flags, file sizes, unused pictures | Read (`staff_content`, activity log) | Never | Never |
| Testimonial author names and areas | Read; the activity log records only that they changed | Never | Published ones only |

## 3. Integrity

- **No overwritten edits:** every save carries the version the screen loaded; a second editor's save is refused, not merged. Reordering is refused if an item was added or removed meanwhile. [content-concurrency, staff-operations]
- **Nothing reaches visitors by accident:** new FAQs, reviews, pictures and announcements start hidden; the homepage heading stays the built-in one until the owner chooses to show theirs. [content-functions, content-to-site]
- **No invented reviews:** the website has no built-in reviews to fall back on; the reviews section is hidden until a real one is published. The staff screen reminds the owner to use only real guests' words, with permission. [site-content]
- **Guests can always reach the spa:** a blank or invalid main phone or WhatsApp number keeps the built-in one; if content cannot be loaded at all, the built-in content is shown. [site-content]

## 4. Audit

The six content tables are covered by the same audit triggers as the rest of the system, with named actions (`content.faq_created`, `content.published`, `content.media_removed`, …) and reasons for deletions. The staff app's Activity log has a "Website content" filter. A real upload and removal on the hosted project were both recorded, the removal with its reason. [content-functions, hosted]

## 5. Accessibility (WCAG 2.1 AA)

An automated scan (axe-core, a pinned development dependency) found 45 contrast failures and 3 unnamed links on the homepage before 6c: the bright gold section labels and tags on light backgrounds (about 1.5:1), light brown body text (3.2–4.3:1), and the social icons. After 6c the scan reports no violations on the homepage at 360, 768 and 1280 px, the video gallery, the booking confirmation page, and every staff Website screen. Bright gold is kept on dark backgrounds; on light ones the words are dark bronze (`#765e16`, at least 4.7:1 on every light panel) with a decorative gold rule. [site-content]

## 6. Findings and residual risks

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | The public site showed three invented guest reviews, and Facebook/X icons linking to those sites' home pages rather than to SMM. | Medium (misleading) | **Fixed in 6c.** Reviews appear only when real ones are published; the two links were removed, Instagram kept and labelled. |
| 2 | 45 contrast failures and 3 unnamed links (section 5). | Medium (accessibility) | **Fixed in 6c.** |
| 3 | The local test server dropped argument names when calling database functions as a signed-in user, so tests never really ran the step where `staff-invite` records the invitation. | Low (test gap) | **Fixed in 6e** (`tests/support/local-backend.ts`); the test now checks that the invitation is recorded. The deployed function was never affected. |
| 4 | After a picture is removed, its public address can keep working for a short time from the storage service's cache. A fresh request was refused straight away. | Low | Inherent to Storage caching. Nothing on the site links to it after removal. [hosted] |
| 5 | The two intake tables still follow their Phase 1 policies (owner/admin may write directly). The app does not use them. | Low | Deferred with 6d (intake). Must be moved behind functions before intake is switched on. |
| 6 | Unused packages left from the original template (`express`, `@google/genai`, `dotenv`) brought known vulnerabilities into the install. | Low | **Removed in 6e.** |
| 7 | One remaining known issue in the build/test tooling (`picomatch`, a pattern-matching denial of service, via Vite and Vitest). It runs only on the developer's computer and the build server, never in visitors' browsers. | Low | Accepted; fixed by the next major Vitest upgrade. |
| 8 | The live site uses the development backend `smm-dev`, which holds demo data and a demo owner account (`demo.owner@example.com`). | — | By the user's choice (demo data until the client is ready). Before the real launch, see section 7. |
| 9 | Anyone with direct database or dashboard access is outside every control above. | Inherent | As in Phase 5: limit to the owner and trusted operators. |

## 6a. Addendum: guest bookings paid by direct bank transfer (18 November 2026)

Added after the review above, at the user's request (`20261019000100`, `20261019000200`). [bank-transfer, booking-handler, staff-operations, site-with-backend, transfer-screens, transfer-page, revert, security-snapshot]

- **Slot safety.** Choosing transfer turns the guest's live reservation into a booking awaiting payment inside the same locks and checks as an online payment (schedule rules, therapist, treatment, area, overlap). It blocks the time like any booking; there is no window in which two guests can hold it.
- **Money ledger.** No provider payment can be attached to a transfer booking (the Phase 5b ledger guard). An online payment that arrives later for the same reservation is flagged for refund as `duplicate_payment`, never a second booking.
- **Who confirms.** Only owner and admin, through `staff_confirm_transfer`, with the record's version; audited with the note. Therapists and guests are refused. A booking not confirmed by its deadline (2 hours, and at the latest 15 minutes before it starts) is cancelled by the maintenance job, audited as a system action. Settlement changes cannot turn a transfer booking into another kind.
- **Guest access.** The guest's page is opened only with an unguessable token (not the booking reference); its server functions are callable only by the Edge Function, which validates the token's form and rate-limits (5 new transfer bookings and 60 status checks per visitor per 10 minutes). A guest can have at most 2 unpaid transfer bookings. The page token is recorded in the activity log only as "changed".
- **Bank details.** Not secret (guests are shown them), readable publicly like the other business settings; changed only by the owner, with a reason, audited.
- **Residual risk.** The spa's bank account is not connected: the owner must check each transfer by hand, and nobody is notified automatically (notifications are out of scope). Someone could reserve times without paying; the 2-hour limit, the per-guest cap and the rate limits bound this.

## 7. Before the real launch

- Create the separate production Supabase project (agreed in the Phase 6 plan) and point the production build at it; keep `smm-dev` for development.
- Invite the real owner through the staff app, then remove the demo owner and all demo rows (bookings, customers, payments; the content is already real).
- Real Paystack test mode, then live, only in their own approved steps; `PAYMENT_PROVIDER=paystack` and the webhook deployed.
- Custom SMTP for invitation and password emails; Auth redirect URL set to the production `/staff/` address.
- Set `ALLOWED_ORIGINS` to the production site address(es) only.
- Revoke the access tokens used during development (Supabase and Vercel).
