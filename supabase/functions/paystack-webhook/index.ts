// Supabase Edge Function entry point (Deno) for payment provider webhooks.
// With PAYMENT_PROVIDER=paystack, set this function's URL as the webhook URL
// in the Paystack dashboard. With PAYMENT_PROVIDER=mock it accepts the
// simulated provider's signed events.
//
// Secrets (function environment only):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided automatically by Supabase
//   PAYMENT_PROVIDER      'mock' or 'paystack'
//   PAYSTACK_SECRET_KEY   only when PAYMENT_PROVIDER=paystack; Paystack signs webhooks with it

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { Rpc } from '../_shared/http.ts';
import { createPaymentGateway } from '../_shared/payments/factory.ts';
import { handleWebhookRequest } from './handler.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rpc: Rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  return { data, error };
};
const gateway = await createPaymentGateway((name) => Deno.env.get(name), rpc);

Deno.serve((req) => handleWebhookRequest(req, { rpc, gateway }));
