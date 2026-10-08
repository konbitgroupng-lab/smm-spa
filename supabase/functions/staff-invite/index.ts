// Supabase Edge Function entry point (Deno). Wires the runtime to handler.ts.
//
// Settings come from the function environment, never from the browser:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   provided by Supabase
//   ALLOWED_ORIGINS    comma-separated origins of the staff app, e.g. "https://example.com"
//   STAFF_APP_URL      where invitation links lead, e.g. "https://example.com/staff/"
//                      (must be listed in the project's Auth redirect URLs)
// Invitation emails are sent by Supabase Auth: configure custom SMTP before use.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleInviteRequest } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const staffAppUrl = Deno.env.get('STAFF_APP_URL')!;
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);

Deno.serve((req) =>
  handleInviteRequest(req, {
    allowedOrigins,
    rpc: async (fn, args) => {
      const { data, error } = await admin.rpc(fn, args);
      return { data, error };
    },
    rpcAsCaller: async (token, fn, args) => {
      const asCaller = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data, error } = await asCaller.rpc(fn, args);
      return { data, error };
    },
    invite: async (email, fullName) => {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: staffAppUrl,
        data: { full_name: fullName },
      });
      if (error) {
        const code = (error as { code?: string }).code;
        return { error: code === 'email_exists' || /already been registered/i.test(error.message) ? 'already_registered' : 'failed' };
      }
      return { userId: data.user.id };
    },
  }),
);
