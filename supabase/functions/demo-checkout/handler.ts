// The simulated provider's hosted checkout (backend for the site's demo
// checkout page). Web-standard APIs only (see booking/handler.ts).
//
// It plays the part of Paystack's checkout servers: it records what the guest
// did in the simulated provider's ledger, then delivers a signed webhook to the
// real webhook handler, just as Paystack would. It never touches payments or
// appointments itself - those change only through record_payment_result(),
// reached via the webhook or the payments endpoint's verify call.
//
// It refuses to work unless the configured provider is the mock.

import { corsHeaders, InvalidRequest, readJsonObject, withinRateLimit, type Rpc } from '../_shared/http.ts';
import type { PaymentGateway } from '../_shared/payments/gateway.ts';
import { MockPaymentGateway } from '../_shared/payments/mock.ts';

export interface DemoCheckoutDeps {
  rpc: Rpc;
  gateway: PaymentGateway;
  /** Hands a signed event to the webhook receiver; returns its HTTP status. */
  deliverWebhook: (delivery: { body: string; headers: Record<string, string> }) => Promise<number>;
  clientKey: (req: Request) => Promise<string>;
  allowedOrigins: string[];
}

const WINDOW_SECONDS = 600;
const LIMITS: Record<string, number> = { get: 120, complete: 30, cancel: 30 };
const REFERENCE = /^[A-Za-z0-9.=-]{8,100}$/;
const OUTCOMES = ['success', 'decline', 'pending'] as const;

/** Where the provider sends the guest back, with Paystack's query parameters. */
function returnUrl(callbackUrl: string | null, reference: string): string | null {
  if (!callbackUrl) return null;
  const url = new URL(callbackUrl);
  url.searchParams.set('trxref', reference);
  url.searchParams.set('reference', reference);
  return url.toString();
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 1)}***@${domain ?? ''}`;
}

export async function handleDemoCheckoutRequest(req: Request, deps: DemoCheckoutDeps): Promise<Response> {
  const headers = corsHeaders(req.headers.get('origin'), deps.allowedOrigins);
  const reply = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!(deps.gateway instanceof MockPaymentGateway)) return reply(404, { error: 'not_available' });
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });

  const body = await readJsonObject(req, 2048);
  if (body === 'too_large') return reply(413, { error: 'payload_too_large' });
  if (body === 'invalid') return reply(400, { error: 'invalid_request', field: 'body' });

  const action = typeof body.action === 'string' ? body.action : '';
  const limit = LIMITS[action];
  if (limit === undefined) return reply(400, { error: 'invalid_request', field: 'action' });

  try {
    if (typeof body.reference !== 'string' || !REFERENCE.test(body.reference)) throw new InvalidRequest('reference');
    const reference = body.reference;
    if (!(await withinRateLimit(deps.rpc, `demo_${action}:${await deps.clientKey(req)}`, limit, WINDOW_SECONDS))) {
      return reply(429, { error: 'rate_limited' });
    }

    const found = await deps.rpc('mock_provider_get', { p_reference: reference });
    if (found.error) throw new Error(found.error.message);
    if (!found.data) return reply(404, { error: 'transaction_not_found' });
    const tx = found.data;

    if (action === 'get') {
      return reply(200, {
        demo: true,
        reference,
        amountMinor: Number(tx.amount),
        currency: tx.currency,
        status: tx.status,
        email: maskEmail(String(tx.email)),
        canReturn: Boolean(tx.callback_url),
      });
    }

    if (action === 'cancel') {
      // The guest closes the checkout without paying: the provider records nothing.
      return reply(200, { status: tx.status, returnUrl: returnUrl(tx.callback_url, reference) });
    }

    // complete
    const outcome = body.outcome;
    if (typeof outcome !== 'string' || !(OUTCOMES as readonly string[]).includes(outcome)) throw new InvalidRequest('outcome');
    // Providers sometimes deliver an event more than once; the demo can do the same on request.
    const deliveries = body.deliveries === undefined ? 1 : body.deliveries;
    if (typeof deliveries !== 'number' || !Number.isInteger(deliveries) || deliveries < 1 || deliveries > 3) throw new InvalidRequest('deliveries');

    const completed = await deps.rpc('mock_provider_complete', { p_reference: reference, p_outcome: outcome });
    if (completed.error) throw new Error(completed.error.message);
    const after = completed.data;

    let webhookStatus: number | null = null;
    if (after.status === 'success') {
      // Paystack sends charge.success for successful charges only; failures are learnt via verify.
      const delivery = await (deps.gateway as MockPaymentGateway).signedEvent('charge.success', {
        id: after.id, domain: 'test', status: 'success', reference, amount: after.amount, currency: after.currency,
        paid_at: after.paid_at, channel: after.channel, gateway_response: after.gateway_response,
      });
      for (let i = 0; i < deliveries; i++) webhookStatus = await deps.deliverWebhook(delivery);
    }

    return reply(200, { status: after.status, webhookStatus, returnUrl: returnUrl(after.callback_url, reference) });
  } catch (err) {
    if (err instanceof InvalidRequest) return reply(400, { error: 'invalid_request', field: err.message });
    console.error('demo-checkout:', action, err instanceof Error ? err.message : err);
    return reply(500, { error: 'server_error' });
  }
}
