// Supabase Edge Function entry point (Deno) for Paystack webhooks.
// Set this function's URL as the webhook URL in the Paystack dashboard.
//
// Secrets (function environment only):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided automatically by Supabase
//   PAYSTACK_SECRET_KEY   also the key Paystack signs webhooks with

import { createClient } from 'npm:@supabase/supabase-js@2';
import { PaystackAdapter } from '../_shared/payments/paystack.ts';
import { handleWebhookRequest } from './handler.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const gateway = new PaystackAdapter(Deno.env.get('PAYSTACK_SECRET_KEY') ?? '');

Deno.serve((req) =>
  handleWebhookRequest(req, {
    rpc: async (fn, args) => {
      const { data, error } = await supabase.rpc(fn, args);
      return { data, error };
    },
    gateway,
  }),
);
