// Paystack webhook receiver. Web-standard APIs only (see booking/handler.ts).
//
// Order of work for every delivery:
//   1. Verify the signature over the raw body. Unsigned or wrongly signed
//      requests are rejected and leave no trace.
//   2. Record the delivery. A delivery that was already fully processed is
//      acknowledged without doing anything again.
//   3. For a payment event, ask Paystack for the transaction's real state and
//      pass that to public.record_payment_result() - the payload itself is not
//      treated as proof.
//   4. Only then mark the delivery processed and answer 200. Any failure
//      answers 500, so Paystack delivers again and step 3 is retried.

import { GatewayError, type PaymentGateway } from '../_shared/payments/gateway.ts';
import type { Rpc } from '../_shared/http.ts';

export interface WebhookDeps {
  rpc: Rpc;
  gateway: PaymentGateway;
}

const MAX_BODY_BYTES = 64 * 1024;

export async function handleWebhookRequest(req: Request, deps: WebhookDeps): Promise<Response> {
  const reply = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  const provider = deps.gateway.name;

  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) return reply(413, { error: 'payload_too_large' });
  if (!(await deps.gateway.verifyWebhookSignature(rawBody, req.headers))) return reply(401, { error: 'invalid_signature' });

  let event;
  try {
    event = deps.gateway.parseWebhook(rawBody);
  } catch {
    return reply(400, { error: 'invalid_payload' });
  }

  let reference: string | null = null;
  try {
    const logged = await deps.rpc('log_payment_event', {
      p_provider: provider,
      p_event_id: event.eventId,
      p_event_type: event.eventType,
      p_payload: event.summary,
    });
    if (logged.error) throw new Error(logged.error.message);
    if (logged.data === true) return reply(200, { received: true, duplicate: true });

    let result = 'ignored';
    if (event.kind === 'charge_success') {
      reference = event.reference;
      const charge = await deps.gateway.verify(reference);
      if (charge.status === 'pending') {
        // Signed event says paid but the API does not agree yet: have Paystack retry.
        throw new GatewayError('transaction not confirmed by verify');
      }
      const recorded = await deps.rpc('record_payment_result', {
        p_provider: provider,
        p_reference: reference,
        p_status: charge.status,
        p_paid_minor: charge.amountMinor,
        p_currency: charge.currency,
        p_paid_at: charge.paidAt,
        p_transaction_id: charge.transactionId,
        p_channel: charge.channel,
        p_failure_reason: charge.failureReason,
      });
      // A transaction on the same Paystack account that this system did not start.
      if (recorded.error && recorded.error.message !== 'payment_not_found') throw new Error(recorded.error.message);
      result = recorded.error ? 'unknown_reference' : recorded.data.status;
    } else if (event.kind === 'refund') {
      reference = event.refund.transactionReference;
      const recorded = await deps.rpc('record_refund_event', {
        p_provider: provider,
        p_transaction_reference: reference,
        p_refund_status: event.refund.status,
        p_refund_reference: event.refund.refundReference,
        p_amount_minor: event.refund.amountMinor,
        p_reason: event.refund.reason,
      });
      if (recorded.error && !['payment_not_found', 'payment_not_paid'].includes(recorded.error.message)) throw new Error(recorded.error.message);
      result = recorded.error ? 'unknown_reference' : 'refund_recorded';
    }

    const finished = await deps.rpc('finish_payment_event', { p_provider: provider, p_event_id: event.eventId, p_reference: reference, p_error: null });
    if (finished.error) throw new Error(finished.error.message);
    return reply(200, { received: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'processing failed';
    console.error('paystack-webhook:', event.eventType, message);
    // Best effort note for staff; the delivery stays unprocessed so a retry reprocesses it.
    await deps
      .rpc('finish_payment_event', { p_provider: provider, p_event_id: event.eventId, p_reference: reference, p_error: message })
      .catch(() => undefined);
    return reply(500, { error: 'processing_failed' });
  }
}
