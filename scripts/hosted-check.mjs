// Read-only health and security check of a hosted Supabase project.
//
//   node --env-file=.env.local scripts/hosted-check.mjs            (development: demo data is a warning)
//   node --env-file=.env.local scripts/hosted-check.mjs --production
//
// Needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (the public values the
// website uses). With SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF it also
// checks migrations, functions, secrets (names only), Auth settings, grants
// and data through the Supabase Management API.
//
// It changes nothing: every database query is a SELECT, and the only other
// requests are reads and requests that must be refused. No secret value is
// ever printed. Exit code 1 if any check fails.

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const production = process.argv.includes('--production');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anon, SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: ref } = process.env;
if (!url || !anon) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (for example with --env-file=.env.local).');
  process.exit(2);
}

const results = [];
const pass = (name, detail) => results.push({ level: 'PASS', name, detail });
const fail = (name, detail) => results.push({ level: 'FAIL', name, detail });
const warn = (name, detail) => results.push({ level: 'WARN', name, detail });
/** In production a problem fails; in development it is a warning. */
const strict = (ok, name, detail) => (ok ? pass(name, detail) : production ? fail(name, detail) : warn(name, detail));
const check = (ok, name, detail) => (ok ? pass(name, detail) : fail(name, detail));

const rest = (p, init = {}) => fetch(`${url}/rest/v1/${p}`, {
  ...init,
  headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
});

// ---------------------------------------------------------------------------
// As a guest (the public website's key)

{
  let r = await rest('services?select=id,name&is_active=eq.true');
  const services = r.ok ? await r.json() : [];
  check(r.ok && services.length > 0, 'guest: treatments can be read', `${services.length} active`);
  r = await rest('faqs?select=id&is_published=eq.true');
  check(r.ok, 'guest: published FAQs can be read', r.ok ? `${(await r.json()).length} published` : `status ${r.status}`);
  r = await rest('faqs?select=id,is_demo');
  check(!r.ok, 'guest: content management columns are not readable', `status ${r.status}`);
  r = await rest('customers?select=id&limit=1');
  check(!r.ok || (await r.json()).length === 0, 'guest: customer records are not readable', `status ${r.status}`);
  r = await rest('appointments?select=id&limit=1');
  check(!r.ok || (await r.json()).length === 0, 'guest: bookings are not readable', `status ${r.status}`);
  r = await rest('payments?select=id&limit=1');
  check(!r.ok || (await r.json()).length === 0, 'guest: payments are not readable', `status ${r.status}`);
  r = await rest('audit_log?select=id&limit=1');
  check(!r.ok || (await r.json()).length === 0, 'guest: the activity log is not readable', `status ${r.status}`);
  r = await rest('rpc/staff_content', { method: 'POST', body: '{}' });
  check(!r.ok, 'guest: staff functions are refused', `status ${r.status}`);

  r = await fetch(`${url}/functions/v1/staff-media`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: '{}' });
  check(r.status === 401, 'staff-media: refuses requests without a staff sign-in', `status ${r.status}`);
  r = await fetch(`${url}/functions/v1/booking`, { method: 'OPTIONS', headers: { Origin: 'https://not-this-site.example', 'Access-Control-Request-Method': 'POST' } });
  const allowed = r.headers.get('access-control-allow-origin');
  check(allowed !== 'https://not-this-site.example' && allowed !== '*', 'booking: other websites are not allowed (CORS)', `allow-origin: ${allowed}`);
}

// ---------------------------------------------------------------------------
// Through the Management API

async function api(p) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}${p}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${p}: status ${r.status}`);
  return r.json();
}
async function sql(query) {
  if (!/^\s*(select|with)\b/i.test(query)) throw new Error('read-only queries only');
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`query: status ${r.status} ${await r.text()}`);
  return r.json();
}

if (!token || !ref) {
  warn('management checks skipped', 'set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF to include them');
} else {
  try {
    // Migrations
    const repo = readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, 14)).sort();
    const applied = (await sql('select version from supabase_migrations.schema_migrations order by version')).map((r) => r.version);
    const missing = repo.filter((v) => !applied.includes(v));
    const unknown = applied.filter((v) => !repo.includes(v));
    check(!missing.length && !unknown.length, 'database: every migration in the repository is applied, and nothing else',
      missing.length || unknown.length ? `missing ${missing.join(', ') || 'none'}; unknown ${unknown.join(', ') || 'none'}` : `${applied.length} applied`);

    // Edge Functions
    const fns = await api('/functions');
    const fn = (slug) => fns.find((f) => f.slug === slug);
    for (const [slug, jwt] of [['booking', false], ['payments', false], ['staff-invite', true], ['staff-media', true]]) {
      const f = fn(slug);
      check(!!f && f.status === 'ACTIVE' && f.verify_jwt === jwt, `function ${slug}: deployed, sign-in check ${jwt ? 'on' : 'off'}`,
        f ? `status ${f.status}, verify_jwt ${f.verify_jwt}` : 'not deployed');
    }
    strict(!fn('demo-checkout'), 'function demo-checkout: not deployed (demo payments only)', fn('demo-checkout') ? 'deployed' : '');
    strict(!!fn('paystack-webhook') && fn('paystack-webhook').verify_jwt === false, 'function paystack-webhook: deployed for real payments',
      fn('paystack-webhook') ? `verify_jwt ${fn('paystack-webhook').verify_jwt}` : 'not deployed');

    // Secrets: names only
    const names = (await api('/secrets')).map((s) => s.name);
    for (const name of ['ALLOWED_ORIGINS', 'RATE_LIMIT_SALT', 'PAYMENT_PROVIDER', 'STAFF_APP_URL']) {
      check(names.includes(name), `secret ${name}: set`, names.includes(name) ? '' : 'missing');
    }
    strict(names.includes('PAYSTACK_SECRET_KEY'), 'secret PAYSTACK_SECRET_KEY: set (real payments)', names.includes('PAYSTACK_SECRET_KEY') ? '' : 'missing');

    // Auth
    const auth = await api('/config/auth');
    check(auth.disable_signup === true, 'auth: public sign-up is disabled', `disable_signup ${auth.disable_signup}`);
    check(Number(auth.password_min_length) >= 10, 'auth: passwords are at least 10 characters', `minimum ${auth.password_min_length}`);
    check(String(auth.uri_allow_list ?? '').includes('/staff/') || String(auth.site_url ?? '').includes('/staff/'),
      'auth: staff app address allowed for invitation and reset links', `site ${auth.site_url}; allowed ${auth.uri_allow_list || 'none'}`);
    strict(!!auth.smtp_host, 'auth: own email server (SMTP) for invitations and password resets', auth.smtp_host ? 'configured' : 'Supabase default (rate-limited)');

    // Grants and policies
    const anonFns = (await sql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute') and p.prorettype <> 'trigger'::regtype
        and n.nspname = 'public'`)).map((r) => r.proname);
    check(anonFns.length === 1 && anonFns[0] === 'get_available_slots', 'grants: guests can call only the availability search', anonFns.join(', '));
    const anonWrites = await sql(`select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`);
    check(anonWrites.length === 0, 'grants: guests cannot write to any table', anonWrites.map((g) => `${g.privilege_type} ${g.table_name}`).join(', '));
    const staffContentWrites = await sql(`select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
        and table_name in ('faqs', 'testimonials', 'gallery_items', 'announcements', 'site_content', 'media_assets',
                           'appointments', 'customers', 'payments', 'services', 'therapists', 'business_settings', 'audit_log')`);
    check(staffContentWrites.length === 0, 'grants: signed-in users change bookings, catalogue and content only through checked functions',
      staffContentWrites.map((g) => `${g.privilege_type} ${g.table_name}`).join(', '));
    const storageWrites = await sql(`select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')`);
    check(storageWrites.length === 0, 'storage: no direct uploads or deletions (only through staff-media)', storageWrites.map((p) => p.policyname).join(', '));
    const noRls = await sql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    check(noRls.length === 0, 'row level security: on for every table', noRls.map((t) => t.relname).join(', '));

    // Data and settings
    const [settings] = await sql(`select allow_demo_payments, online_payment_enabled from public.business_settings`);
    strict(settings && settings.allow_demo_payments === false, 'settings: demo payments switched off', `allow_demo_payments ${settings?.allow_demo_payments}`);
    const demo = await sql(`select 'customers' t, count(*)::int n from public.customers where is_demo
      union all select 'appointments', count(*)::int from public.appointments where is_demo
      union all select 'payments', count(*)::int from public.payments where is_demo
      union all select 'staff profiles', count(*)::int from public.profiles where is_demo
      union all select 'treatments', count(*)::int from public.services where is_demo
      union all select 'therapists', count(*)::int from public.therapists where is_demo
      union all select 'site content', count(*)::int from public.site_content where is_demo
      union all select 'FAQs', count(*)::int from public.faqs where is_demo
      union all select 'testimonials', count(*)::int from public.testimonials where is_demo`);
    const leftover = demo.filter((d) => d.n > 0);
    strict(leftover.length === 0, 'data: no demo records', leftover.map((d) => `${d.n} ${d.t}`).join(', '));
    const [owners] = await sql(`select count(*)::int n, count(*) filter (where not is_demo)::int real from public.profiles where role = 'owner' and is_active`);
    check(owners.n >= 1, 'staff: at least one active owner', `${owners.n} active`);
    strict(owners.real >= 1, 'staff: a real (non-demo) owner account exists', `${owners.real} real`);
    const [cron] = await sql(`select count(*)::int n,
        (select status from cron.job_run_details d where d.jobid = j.jobid order by start_time desc limit 1) as last
      from cron.job j where jobname = 'booking-maintenance' group by j.jobid`).then((r) => (r.length ? r : [{ n: 0, last: null }]));
    check(cron.n === 1 && cron.last === 'succeeded', 'maintenance: expired reservations are released every minute', `job ${cron.n ? 'present' : 'missing'}, last run ${cron.last}`);
  } catch (err) {
    fail('management checks could not run', String(err.message ?? err));
  }
}

// ---------------------------------------------------------------------------

const width = Math.max(...results.map((r) => r.name.length));
console.log(`Hosted check: ${url} (${production ? 'production' : 'development'} rules)\n`);
for (const r of results) console.log(`${r.level}  ${r.name.padEnd(width)}  ${r.detail ?? ''}`.trimEnd());
const failed = results.filter((r) => r.level === 'FAIL').length;
const warned = results.filter((r) => r.level === 'WARN').length;
console.log(`\n${results.length - failed - warned} passed, ${warned} warnings, ${failed} failed`);
process.exit(failed ? 1 : 0);
