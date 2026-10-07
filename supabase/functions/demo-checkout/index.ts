// Supabase Edge Function entry point (Deno) for the simulated provider's
// hosted checkout. Only active when PAYMENT_PROVIDER=mock; otherwise every
// request gets 404. Do not deploy it to production.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (automatic), PAYMENT_PROVIDER,
// ALLOWED_ORIGINS, RATE_LIMIT_SALT.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { visitorKey, type Rpc } from '../_shared/http.ts';
import { createPaymentGateway } from '../_shared/payments/factory.ts';
import { handleWebhookRequest } from '../paystack-webhook/handler.ts';
import { handleDemoCheckoutRequest } from './handler.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rpc: Rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  return { data, error };
};
const gateway = await createPaymentGateway((name) => Deno.env.get(name), rpc);
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const salt = Deno.env.get('RATE_LIMIT_SALT') ?? '';

Deno.serve((req) =>
  handleDemoCheckoutRequest(req, {
    rpc,
    gateway,
    // The same webhook code path a provider's delivery takes, run in-process.
    deliverWebhook: async ({ body, headers }) =>
      (await handleWebhookRequest(new Request('https://internal/payment-webhook', { method: 'POST', headers, body }), { rpc, gateway })).status,
    clientKey: (request) => visitorKey(request, salt),
    allowedOrigins,
  }),
);
