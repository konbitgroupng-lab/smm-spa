// Creates clearly-labelled DEMO staff logins for local development.
//
//   npm run db:seed-users
//
// Reads from the environment (see .env.example):
//   SUPABASE_URL                project URL (local: http://127.0.0.1:54321)
//   SUPABASE_SERVICE_ROLE_KEY   server-only key; printed by `supabase status`
//   DEMO_USER_PASSWORD          optional; a random password is generated when unset
//
// No credentials are hard-coded. The script refuses to run against a hosted
// project: production staff are invited from the Supabase dashboard instead.

import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (run `npx supabase status` for local values).');
  process.exit(1);
}

const { hostname } = new URL(url);
if (!['127.0.0.1', 'localhost'].includes(hostname)) {
  console.error(`Refusing to create demo users on ${hostname}: demo accounts are for local development only.`);
  process.exit(1);
}

const password = process.env.DEMO_USER_PASSWORD || randomBytes(12).toString('base64url');
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const demoUsers = [
  { email: 'demo.owner@example.com', role: 'owner', fullName: '[DEMO] Owner' },
  { email: 'demo.therapist@example.com', role: 'therapist', fullName: '[DEMO] Therapist' },
];

for (const user of demoUsers) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: user.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: user.fullName },
  });
  if (error) {
    console.error(`${user.email}: ${error.message}`);
    continue;
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ role: user.role, is_active: true, is_demo: true, full_name: user.fullName })
    .eq('id', data.user.id);
  if (profileError) throw profileError;

  if (user.role === 'therapist') {
    // Link the login to the first demo therapist so "own appointments" has data to show.
    const { data: therapist, error: findError } = await supabase
      .from('therapists')
      .select('id')
      .eq('is_demo', true)
      .is('profile_id', null)
      .order('sort_order')
      .limit(1)
      .maybeSingle();
    if (findError) throw findError;
    if (therapist) {
      const { error: linkError } = await supabase.from('therapists').update({ profile_id: data.user.id }).eq('id', therapist.id);
      if (linkError) throw linkError;
    }
  }
  console.log(`Created ${user.role}: ${user.email}`);
}

if (!process.env.DEMO_USER_PASSWORD) {
  console.log(`\nGenerated demo password (shown once): ${password}`);
}
