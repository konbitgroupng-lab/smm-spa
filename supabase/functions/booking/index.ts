// Supabase Edge Function entry point (Deno). Wires the runtime to handler.ts.
//
// Secrets come from the function environment, never from the browser:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided automatically by Supabase
//   ALLOWED_ORIGINS    comma-separated site origins, e.g. "https://example.com"
//   RATE_LIMIT_SALT    any random string; keeps rate-limit keys unlinkable to IPs

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleBookingRequest } from './handler.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const salt = Deno.env.get('RATE_LIMIT_SALT') ?? '';

async function clientKey(req: Request): Promise<string> {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve((req) =>
  handleBookingRequest(req, {
    rpc: async (fn, args) => {
      const { data, error } = await supabase.rpc(fn, args);
      return { data, error };
    },
    clientKey,
    allowedOrigins,
  }),
);
