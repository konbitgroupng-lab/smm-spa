// Supabase Edge Function entry point (Deno) for the guest payment endpoint.
//
// Secrets (function environment only, never the browser or the database):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided automatically by Supabase
//   PAYMENT_PROVIDER      'mock' (simulated payments) or 'paystack'
//   PAYSTACK_SECRET_KEY   only when PAYMENT_PROVIDER=paystack
//   DEMO_CHECKOUT_URL     optional, mock only: the site page that plays the hosted checkout
//   ALLOWED_ORIGINS       comma-separated site origins
//   RATE_LIMIT_SALT       any random string

import { createClient } from 'npm:@supabase/supabase-js@2';
import { visitorKey, type Rpc } from '../_shared/http.ts';
import { createPaymentGateway } from '../_shared/payments/factory.ts';
import { handlePaymentsRequest } from './handler.ts';

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
  handlePaymentsRequest(req, {
    rpc,
    gateway,
    clientKey: (request) => visitorKey(request, salt),
    allowedOrigins,
  }),
);
