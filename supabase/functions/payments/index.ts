// Supabase Edge Function entry point (Deno) for the guest payment endpoint.
//
// Secrets (function environment only, never the browser or the database):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided automatically by Supabase
//   PAYSTACK_SECRET_KEY   sk_test_... in development, sk_live_... in production
//   ALLOWED_ORIGINS       comma-separated site origins
//   RATE_LIMIT_SALT       any random string

import { createClient } from 'npm:@supabase/supabase-js@2';
import { visitorKey } from '../_shared/http.ts';
import { PaystackAdapter } from '../_shared/payments/paystack.ts';
import { handlePaymentsRequest } from './handler.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const gateway = new PaystackAdapter(Deno.env.get('PAYSTACK_SECRET_KEY') ?? '');
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const salt = Deno.env.get('RATE_LIMIT_SALT') ?? '';

Deno.serve((req) =>
  handlePaymentsRequest(req, {
    rpc: async (fn, args) => {
      const { data, error } = await supabase.rpc(fn, args);
      return { data, error };
    },
    gateway,
    clientKey: (request) => visitorKey(request, salt),
    allowedOrigins,
  }),
);
