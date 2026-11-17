# Launch runbook

How to take the SMM website from its current state (live at https://smm-spa.vercel.app, running on the development backend `smm-dev` with demo data and demo payments) to the real launch, and how to undo each step. Written for whoever carries out the launch with the owner. Follow the steps in order; each ends with a check.

Nothing here has been done yet. Each part is its own approved step: the production backend (sections 2–6), real Paystack test mode, then live payments (section 7), and the domain (section 8).

## 1. What is needed from the client first

| Item | Used in | Notes |
| --- | --- | --- |
| Owner's name and email address | 4.4 | They receive the staff-app invitation. |
| Confirmed treatments, packages, prices, durations, therapists and in-home areas with travel fees | 4.5 | Or confirmation that the ones on the website today are right. |
| Paystack account approved for NGN card payments; test secret key first, live later | 7 | Never sent by chat or email: it is pasted straight into the Supabase secrets screen. |
| An email sending service (SMTP) login, for example the client's Google Workspace, Zoho or Resend | 5 | So invitations and password-reset emails arrive reliably. |
| Domain name, if wanted (for example `smmspa.ng`) | 8 | Bought by the client, in their name. |
| Bank account for direct transfers | 4.3 | The site offers the account from the previous version (Standard Chartered Bank, 0013819712, Sweet Mobile Massage and Spa Limited). The owner confirms or corrects it in the staff app (Settings › Bank transfer). |
| Second phone number check | — | The footer shows +234 706 667 2648 (the number its call link always dialled); the old text said 0706 672 648. The owner can correct it in Website › Contact details. |

## 2. Fix now on the development backend (small, safe)

The development project's Auth Site URL is still `http://localhost:3000` and no redirect address is allowed, so a password-reset or invitation email from the live staff app would link to a page that does not work. In Supabase: Authentication › URL Configuration:

- Site URL: `https://smm-spa.vercel.app`
- Redirect URLs: `https://smm-spa.vercel.app/staff/` and `http://localhost:3000/staff/`

Check: `node --env-file=.env.local scripts/hosted-check.mjs` shows no FAIL.

## 3. Create the production backend

1. supabase.com › New project, in the client's organisation (or transfer it later): name `smm-production`, region **West EU (Ireland)** like `smm-dev`, a long generated database password stored in a password manager. Choose the **Pro plan**: the free plan has no automatic backups and pauses inactive projects.
2. Authentication › Sign In / Providers: Email on, **"Allow new users to sign up" off**, minimum password length **10**.
3. Authentication › URL Configuration: Site URL `https://<site>` and Redirect URL `https://<site>/staff/` (`<site>` is `smm-spa.vercel.app` or the domain from section 8).
4. Authentication › Emails › SMTP: the client's email service (section 1).
5. Storage: nothing to do (the migrations create the `site-media` bucket).
6. Create an access token (Account › Access Tokens), and put it with the new project's ref, URL and anon key in `.env.production.local` (git-ignored, like `.env.local`):

   ```
   SUPABASE_ACCESS_TOKEN=…
   SUPABASE_PROJECT_REF=…
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=…
   ```

## 4. Database

1. **Schema.** List, then apply, the migrations (each migration is all-or-nothing, and the script stops at the first failure):

   ```bash
   node --env-file=.env.production.local scripts/apply-migrations.mjs           # lists them
   node --env-file=.env.production.local scripts/apply-migrations.mjs --apply
   ```

   (`npx supabase db push` also works from a computer that can reach the database directly.)
2. **Starting data.** In the SQL editor, run `supabase/seed.sql`. It creates the business settings, opening hours, the catalogue as on today's website, and demo rows that step 4.5 removes.
3. **Payments off until Paystack is connected** (SQL editor). Demo payments are never allowed in production, and until section 7 the booking section offers WhatsApp and phone instead of online payment:

   ```sql
   update public.business_settings set allow_demo_payments = false, online_payment_enabled = false;
   ```

   Section 7 switches online payment back on (staff app › Settings, owner only). Guests can still book meanwhile by **direct bank transfer**, if the owner has confirmed the account (Settings › Bank transfer): their time is reserved for 2 hours and the owner confirms each transfer under Today › Bank transfers to check.
4. **The owner.** Deploy the functions first (section 6), then: Authentication › Users › Invite user with the owner's email. When they have set their password, make them owner once, in the SQL editor:

   ```sql
   update public.profiles p set role = 'owner', is_active = true
     from auth.users u where u.id = p.id and lower(u.email) = lower('<owner email>');
   ```

5. **Remove the demo data.** Open `supabase/snippets/purge_demo_data.sql`; set `KEEP_CATALOGUE` to `true` if the client confirmed today's treatments (or `false` after entering the real ones in the staff app); run it in the SQL editor. It refuses to run until a real owner exists.
6. **Website content.** Run `supabase/snippets/load_site_content.sql`: the website's seven FAQs, five gallery pictures and contact details become editable in the staff app.

Check: `node --env-file=.env.production.local scripts/hosted-check.mjs --production` (section 9).

## 5. Email

With SMTP set (3.4), send the owner a password reset from the staff app's "Forgot password?" to confirm emails arrive and link to `https://<site>/staff/`.

## 6. Edge Functions and their settings

Secrets (Edge Functions › Secrets, or `npx supabase secrets set … --project-ref <ref>`):

| Secret | Value |
| --- | --- |
| `ALLOWED_ORIGINS` | `https://<site>` (and `https://www.<domain>` if used); nothing else in production |
| `RATE_LIMIT_SALT` | a long random string (new, not the development one) |
| `STAFF_APP_URL` | `https://<site>/staff/` |
| `PAYMENT_PROVIDER` | `paystack`, with `PAYSTACK_SECRET_KEY` (section 7). Never `mock` in production. |

Deploy (the sign-in setting of each comes from `supabase/config.toml`):

```bash
npx supabase functions deploy booking --project-ref <ref> --use-api
npx supabase functions deploy payments --project-ref <ref> --use-api
npx supabase functions deploy paystack-webhook --project-ref <ref> --use-api
npx supabase functions deploy staff-invite --project-ref <ref> --use-api
npx supabase functions deploy staff-media --project-ref <ref> --use-api
```

Do **not** deploy `demo-checkout` to production.

## 7. Payments (separately approved steps)

Follow "Future Paystack integration" in `DEVELOPMENT.md`: test secret key and test webhook first, one complete test booking and one failed payment, then the live key and live webhook. The secret key is set only as a function secret; it is never stored in the database, the code, or the staff app.

## 8. The website

1. Vercel › smm-spa › Settings › Environment Variables, **Production** only: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` of the production project. Preview and Development keep `smm-dev`.
2. Redeploy production (Deployments › latest production › Redeploy), or push to `master`.
3. Domain (optional): Settings › Domains › add the domain, set the DNS records Vercel shows at the registrar, then update 3.3, 6 (`ALLOWED_ORIGINS`, `STAFF_APP_URL`) and redeploy the functions.

## 9. Checks after launch

```bash
node --env-file=.env.production.local scripts/hosted-check.mjs --production
```

It only reads; in production mode demo data, demo payments, a missing Paystack key or the default email service are failures. Then by hand, on a phone and a computer:

- The homepage loads; FAQs, gallery, contact details and the WhatsApp button are right.
- A real booking with a small real payment (then refund it in Paystack and record the refund in the staff app).
- The owner signs in to `/staff/`, sees the booking, edits an FAQ and sees it on the site.

## 10. Undoing

| What | How |
| --- | --- |
| A website release | Vercel › Deployments › the previous production deployment › **Instant Rollback** (no rebuild; takes seconds). Or `git revert` the change on `master` and push. |
| Pointing the site at production | Put the `smm-dev` values back in Vercel's Production variables and redeploy. |
| Real payments | `PAYMENT_PROVIDER` back to `mock` (development only) or remove it: the site falls back to WhatsApp and phone booking. Paid bookings stay. |
| Direct bank transfer | Switch it off (staff app › Settings › Bank transfer, owner): the option disappears from the booking step at once. To remove it from the database, after cancelling or rebooking any transfer bookings: `supabase/revert/20261019000200_bank_transfer.down.sql`, then `delete from supabase_migrations.schema_migrations where version = '20261019000200';` (the `bank_transfer` enum value stays; it is harmless). Tested in `tests/db/revert.test.ts`. |
| The Phase 6 database changes (content functions and rules) | In the SQL editor, in one transaction: the bank transfer rollback above first, then `supabase/revert/20261016000200_content_functions.down.sql`, then `supabase/revert/20261016000100_content_security.down.sql`, then `delete from supabase_migrations.schema_migrations where version in ('20261016000100', '20261016000200');`. Content is kept; the staff Website section stops working until the migrations are applied again (`apply-migrations.mjs --apply`). Tested in `tests/db/revert.test.ts`. Deploy the matching website version too (Vercel Instant Rollback to a release before Phase 6b). |

## 11. Afterwards

- Revoke the access tokens used for the launch (Supabase › Account › Access Tokens; Vercel › Account Settings › Tokens) and remove them from `.env.*.local`.
- Remove the demo owner from `smm-dev` too if it is no longer needed for development.
- Review who has access to the Supabase dashboard, Vercel and Paystack: only the owner and the people they trust.
