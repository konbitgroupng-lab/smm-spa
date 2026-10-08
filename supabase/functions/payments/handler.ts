// Guest payment endpoint: start a payment for a hold, and ask for the verified
// outcome of a payment. Web-standard APIs only (see booking/handler.ts).
//
// Nothing here decides that a payment succeeded. `verify` asks the provider and
// hands the provider's answer to public.record_payment_result(), which is the
// only place a payment can become an appointment.

import { GatewayError, type PaymentGateway } from '../_shared/payments/gateway.ts';
import { corsHeaders, InvalidRequest, optionalText, readJsonObject, UUID, withinRateLimit, type Rpc } from '../_shared/http.ts';

export interface PaymentsDeps {
  rpc: Rpc;
  gateway: PaymentGateway;
  /** Opaque per-visitor key for rate limiting (a hash, never a raw IP). */
  clientKey: (req: Request) => Promise<string>;
  allowedOrigins: string[];
}

const WINDOW_SECONDS = 600;
const LIMITS: Record<string, number> = { initialize: 10, verify: 60 };
const REFERENCE = /^[A-Za-z0-9.=-]{8,100}$/;

const ERROR_STATUS: Record<string, number> = {
  hold_expired: 410,
  customer_required: 422,
  address_required: 422,
  nothing_to_pay: 422,
  payments_disabled: 503,
  demo_payments_disabled: 503,
};

/** Outcome fields a guest holding the reference may see. */
function publicOutcome(outcome: any, gateway: PaymentGateway) {
  return {
    demo: gateway.name === 'mock',
    status: outcome.status as 'confirmed' | 'cancelled' | 'pending' | 'failed' | 'refund_required',
    reason: outcome.reason ?? undefined,
    appointment: outcome.appointment
      ? { reference: outcome.appointment.reference, startsAt: outcome.appointment.starts_at, endsAt: outcome.appointment.ends_at }
      : null,
  };
}

/** The checkout may only send the guest back to one of our own sites. */
function callbackUrl(value: unknown, allowedOrigins: string[]): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 500) throw new InvalidRequest('callbackUrl');
  let origin: string;
  try {
    origin = new URL(value).origin;
  } catch {
    throw new InvalidRequest('callbackUrl');
  }
  if (!allowedOrigins.includes(origin)) throw new InvalidRequest('callbackUrl');
  return value;
}

type Result = { status: number; body: unknown };

async function initialize(body: Record<string, unknown>, deps: PaymentsDeps): Promise<Result> {
  if (typeof body.holdToken !== 'string' || !UUID.test(body.holdToken)) throw new InvalidRequest('holdToken');
  const callback = callbackUrl(body.callbackUrl, deps.allowedOrigins);

  const begun = await deps.rpc('begin_hold_payment', {
    p_hold_token: body.holdToken,
    p_provider: deps.gateway.name,
    p_is_test: deps.gateway.isTestMode,
    p_service_address: optionalText(body.serviceAddress, 'serviceAddress', 300),
    p_customer_notes: optionalText(body.notes, 'notes', 1000),
  });
  if (begun.error) {
    const status = ERROR_STATUS[begun.error.message];
    if (!status) throw new Error(begun.error.message);
    return { status, body: { error: begun.error.message } };
  }
  const payment = begun.data;

  let checkoutUrl: string | null = payment.checkout_url;
  if (!checkoutUrl) {
    try {
      checkoutUrl = (
        await deps.gateway.initialize({
          reference: payment.reference,
          amountMinor: Number(payment.amount_minor),
          currency: payment.currency,
          email: payment.email,
          callbackUrl: callback,
        })
      ).checkoutUrl;
    } catch (err) {
      // Close the record so the guest's next attempt starts a fresh transaction.
      await deps.rpc('mark_payment_init_failed', {
        p_provider: deps.gateway.name,
        p_reference: payment.reference,
        p_reason: err instanceof GatewayError ? err.message : 'initialization failed',
      });
      console.error('payments: initialize failed', err instanceof Error ? err.message : err);
      return { status: 502, body: { error: 'gateway_unavailable' } };
    }
    const saved = await deps.rpc('set_payment_checkout', { p_provider: deps.gateway.name, p_reference: payment.reference, p_checkout_url: checkoutUrl });
    if (saved.error) throw new Error(saved.error.message);
  }

  return {
    status: 200,
    body: {
      reference: payment.reference,
      checkoutUrl,
      amountMinor: Number(payment.amount_minor),
      bookingTotalMinor: Number(payment.booking_total_minor),
      currency: payment.currency,
      kind: payment.kind,
      holdExpiresAt: payment.hold_expires_at,
      // Decided by the server's configuration, so the site can never present a
      // simulated payment as a real one, or the reverse.
      provider: deps.gateway.name,
      demo: deps.gateway.name === 'mock',
    },
  };
}

async function verify(body: Record<string, unknown>, deps: PaymentsDeps): Promise<Result> {
  if (typeof body.reference !== 'string' || !REFERENCE.test(body.reference)) throw new InvalidRequest('reference');
  const reference = body.reference;

  // Only references we issued are ever looked up at the provider.
  const current = await deps.rpc('get_payment_outcome', { p_provider: deps.gateway.name, p_reference: reference });
  if (current.error) throw new Error(current.error.message);
  if (!current.data) return { status: 404, body: { error: 'payment_not_found' } };
  // Final outcomes need no further word from the provider.
  if (['confirmed', 'cancelled', 'refund_required'].includes(current.data.status)) {
    return { status: 200, body: publicOutcome(current.data, deps.gateway) };
  }

  let charge;
  try {
    charge = await deps.gateway.verify(reference);
  } catch (err) {
    console.error('payments: verify failed', err instanceof Error ? err.message : err);
    return { status: 502, body: { error: 'gateway_unavailable' } };
  }
  // "Not paid yet" changes nothing; the guest may still be on the checkout page.
  if (charge.status === 'pending') return { status: 200, body: publicOutcome(current.data, deps.gateway) };

  const recorded = await deps.rpc('record_payment_result', {
    p_provider: deps.gateway.name,
    p_reference: reference,
    p_status: charge.status,
    p_paid_minor: charge.amountMinor,
    p_currency: charge.currency,
    p_paid_at: charge.paidAt,
    p_transaction_id: charge.transactionId,
    p_channel: charge.channel,
    p_failure_reason: charge.failureReason,
  });
  if (recorded.error) throw new Error(recorded.error.message);
  return { status: 200, body: publicOutcome(recorded.data, deps.gateway) };
}

export async function handlePaymentsRequest(req: Request, deps: PaymentsDeps): Promise<Response> {
  const headers = corsHeaders(req.headers.get('origin'), deps.allowedOrigins);
  const reply = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });

  const body = await readJsonObject(req, 4096);
  if (body === 'too_large') return reply(413, { error: 'payload_too_large' });
  if (body === 'invalid') return reply(400, { error: 'invalid_request', field: 'body' });

  const action = typeof body.action === 'string' ? body.action : '';
  const limit = LIMITS[action];
  if (limit === undefined) return reply(400, { error: 'invalid_request', field: 'action' });

  try {
    if (!(await withinRateLimit(deps.rpc, `pay_${action}:${await deps.clientKey(req)}`, limit, WINDOW_SECONDS))) {
      return reply(429, { error: 'rate_limited' });
    }
    const result = action === 'initialize' ? await initialize(body, deps) : await verify(body, deps);
    return reply(result.status, result.body);
  } catch (err) {
    if (err instanceof InvalidRequest) return reply(400, { error: 'invalid_request', field: err.message });
    console.error('payments:', action, err instanceof Error ? err.message : err);
    return reply(500, { error: 'server_error' });
  }
}
