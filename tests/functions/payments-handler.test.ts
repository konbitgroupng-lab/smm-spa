import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { PaystackAdapter } from '../../supabase/functions/_shared/payments/paystack';
import { handlePaymentsRequest, type PaymentsDeps } from '../../supabase/functions/payments/handler';
import { handleWebhookRequest } from '../../supabase/functions/paystack-webhook/handler';
import { at, upcoming } from '../db/dates';
import { createTestDb, one, rows } from '../db/harness';
import { FAKE_SECRET_KEY, startFakePaystack, type FakePaystack } from '../support/fake-paystack';
import { pgliteRpc } from '../support/rpc';

// The guest payment endpoint and the webhook receiver, running against the real
// database functions and a simulated Paystack reached over HTTP by the real adapter.

let db: PGlite;
let paystack: FakePaystack;
let gateway: PaystackAdapter;
let swedish: string;
let A: string;
const PRICE = 4_000_000;
const SITE = 'http://localhost:3000';

let visitor = 0;
function deps(overrides: Partial<PaymentsDeps> = {}): PaymentsDeps {
  const key = `visitor-${++visitor}`;
  return { rpc: pgliteRpc(db), gateway, clientKey: async () => key, allowedOrigins: [SITE], ...overrides };
}

function pay(body: unknown, d = deps(), init: RequestInit = {}) {
  return handlePaymentsRequest(
    new Request('https://project.functions.example/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    }),
    d,
  );
}

function webhook(delivery: { body: string; headers: Record<string, string> }, init: RequestInit = {}) {
  return handleWebhookRequest(
    new Request('https://project.functions.example/paystack-webhook', { method: 'POST', headers: delivery.headers, body: delivery.body, ...init }),
    { rpc: pgliteRpc(db), gateway },
  );
}

let slotIndex = 0;
const TIMES = ['09:00', '11:00', '14:00', '16:00', '18:00'];
function nextSlot(): Date {
  const i = slotIndex++;
  return at(upcoming(1 + (Math.floor(i / TIMES.length) % 6), Math.floor(i / (TIMES.length * 6))), TIMES[i % TIMES.length]);
}

let guest = 0;
async function readyHold(start = nextSlot(), withCustomer = true) {
  const rpc = pgliteRpc(db);
  const hold = (await rpc('request_booking_hold', { p_service_id: swedish, p_starts_at: start.toISOString(), p_therapist_id: A })).data;
  if (withCustomer) {
    await rpc('attach_customer_to_hold', { p_hold_token: hold.hold_token, p_full_name: 'Test Guest', p_email: `guest${++guest}@example.com`, p_phone: '+2348000000000' });
  }
  return hold;
}
async function started(hold?: any) {
  const h = hold ?? (await readyHold());
  const res = await pay({ action: 'initialize', holdToken: h.hold_token });
  return { hold: h, ...(await res.json()) } as { hold: any; reference: string; checkoutUrl: string; amountMinor: number };
}
const verify = async (reference: string, extra: Record<string, unknown> = {}) => {
  const res = await pay({ action: 'verify', reference, ...extra });
  return { status: res.status, ...(await res.json()) };
};
const payment = (reference: string) => one(db, `select * from payments where provider_reference = $1`, [reference]);
const appointmentsFor = (holdId: string) => rows(db, `select * from appointments where hold_id = $1`, [holdId]);
const expire = (holdId: string) => db.query(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [holdId]);
const count = (prefix: string) => paystack.requests.filter((r) => r.startsWith(prefix)).length;

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`delete from appointments`);
  await db.query(`update business_settings set online_payment_enabled = true, payment_mode = 'full'`);
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  A = (await one(db, `select id from therapists where sort_order = 1`)).id;
  paystack = await startFakePaystack();
  gateway = new PaystackAdapter(FAKE_SECRET_KEY, { baseUrl: paystack.url });
});
afterAll(() => paystack.close());

describe('payments endpoint: initialize', () => {
  it('starts a hosted checkout for the server-calculated amount and ignores any amount from the browser', async () => {
    const hold = await readyHold();
    const res = await pay({ action: 'initialize', holdToken: hold.hold_token, amountMinor: 1, amount: 1, currency: 'USD', callbackUrl: `${SITE}/booking/return` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['amountMinor', 'bookingTotalMinor', 'checkoutUrl', 'currency', 'demo', 'holdExpiresAt', 'kind', 'provider', 'reference']);
    expect(body).toMatchObject({ amountMinor: PRICE, bookingTotalMinor: PRICE, currency: 'NGN', kind: 'full', provider: 'paystack', demo: false });
    expect(body.checkoutUrl).toMatch(/^https:\/\/checkout\.paystack\.com\//);
    expect(paystack.transactions.get(body.reference)).toMatchObject({ amount: PRICE, currency: 'NGN', callback_url: `${SITE}/booking/return` });
    expect(await payment(body.reference)).toMatchObject({ status: 'initialized', checkout_url: body.checkoutUrl, is_test: true });
  });

  it('returns the same transaction when asked again, without calling Paystack twice', async () => {
    const hold = await readyHold();
    const before = count('POST /transaction/initialize');
    const first = await started(hold);
    const second = await started(hold);
    expect(second.reference).toBe(first.reference);
    expect(second.checkoutUrl).toBe(first.checkoutUrl);
    expect(count('POST /transaction/initialize') - before).toBe(1);
  });

  it('only lets the checkout return to this site', async () => {
    const hold = await readyHold();
    for (const bad of ['https://evil.example/steal', 'javascript:alert(1)', 'not a url']) {
      const res = await pay({ action: 'initialize', holdToken: hold.hold_token, callbackUrl: bad });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_request', field: 'callbackUrl' });
    }
    expect(await rows(db, `select id from payments where hold_id = $1`, [hold.id])).toEqual([]);
  });

  it('refuses holds that are not ready to be paid for', async () => {
    const bare = await readyHold(nextSlot(), false);
    expect((await pay({ action: 'initialize', holdToken: bare.hold_token })).status).toBe(422);

    const gone = await readyHold();
    await expire(gone.id);
    const expired = await pay({ action: 'initialize', holdToken: gone.hold_token });
    expect(expired.status).toBe(410);
    expect(await expired.json()).toEqual({ error: 'hold_expired' });

    const off = await readyHold();
    await db.query(`update business_settings set online_payment_enabled = false`);
    expect((await pay({ action: 'initialize', holdToken: off.hold_token })).status).toBe(503);
    await db.query(`update business_settings set online_payment_enabled = true`);
  });

  it('answers 502 when Paystack is down and lets the guest try again afterwards', async () => {
    const hold = await readyHold();
    paystack.setOutage(true);
    const down = await pay({ action: 'initialize', holdToken: hold.hold_token });
    paystack.setOutage(false);
    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({ error: 'gateway_unavailable' });
    expect(await rows(db, `select status from payments where hold_id = $1`, [hold.id])).toEqual([{ status: 'failed' }]);

    const retry = await pay({ action: 'initialize', holdToken: hold.hold_token });
    expect(retry.status).toBe(200);
  });
});

describe('payments endpoint: verify', () => {
  it('confirms the booking only after Paystack reports the payment', async () => {
    const { hold, reference } = await started();

    expect(await verify(reference)).toMatchObject({ status: 'pending', appointment: null });
    expect(await appointmentsFor(hold.id)).toEqual([]);

    paystack.pay(reference);
    const confirmed = await verify(reference);
    const [appointment] = await appointmentsFor(hold.id);
    expect(confirmed).toMatchObject({ status: 'confirmed', appointment: { reference: appointment.reference } });
    expect(Object.keys(confirmed).sort()).toEqual(['appointment', 'demo', 'status']);
    expect(confirmed.demo).toBe(false);
    expect(await payment(reference)).toMatchObject({ status: 'succeeded', appointment_id: appointment.id });
  });

  it('cannot be talked into confirming by anything the browser sends', async () => {
    const { hold, reference } = await started();
    const claim = await verify(reference, { status: 'success', paid: true, amountMinor: PRICE, trxref: reference });
    expect(claim).toMatchObject({ status: 'pending', appointment: null });
    expect(await appointmentsFor(hold.id)).toEqual([]);
    expect((await payment(reference)).status).toBe('initialized');
  });

  it('does not contact Paystack again once the outcome is final', async () => {
    const { reference } = await started();
    paystack.pay(reference);
    await verify(reference);
    const before = count('GET /transaction/verify');
    const again = await verify(reference);
    expect(again.status).toBe('confirmed');
    expect(count('GET /transaction/verify')).toBe(before);
  });

  it('reports a declined payment as failed, and a retry can then succeed', async () => {
    const { hold, reference } = await started();
    paystack.decline(reference, 'Insufficient Funds');
    expect(await verify(reference)).toMatchObject({ status: 'failed', appointment: null });
    expect(await payment(reference)).toMatchObject({ status: 'failed', failure_reason: 'Insufficient Funds' });

    const retry = await started(hold);
    expect(retry.reference).not.toBe(reference);
    paystack.pay(retry.reference);
    expect(await verify(retry.reference)).toMatchObject({ status: 'confirmed' });
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
  });

  it('refuses to book when Paystack reports a different amount or currency than expected', async () => {
    const underpaid = await started();
    paystack.pay(underpaid.reference, { amount: 100 });
    expect(await verify(underpaid.reference)).toMatchObject({ status: 'refund_required', reason: 'amount_mismatch', appointment: null });
    expect(await appointmentsFor(underpaid.hold.id)).toEqual([]);

    const wrongCurrency = await started();
    paystack.pay(wrongCurrency.reference, { currency: 'USD' });
    expect(await verify(wrongCurrency.reference)).toMatchObject({ status: 'refund_required', reason: 'currency_mismatch' });
    expect(await payment(wrongCurrency.reference)).toMatchObject({ needs_refund: true, paid_currency: 'USD' });
  });

  it('rejects malformed references and never looks up references it did not issue', async () => {
    for (const bad of ['short', 'has spaces in it!', "x'; drop table payments;--", 12345678]) {
      expect(await verify(bad as string)).toMatchObject({ status: 400, error: 'invalid_request', field: 'reference' });
    }
    const before = count('GET /transaction/verify');
    expect(await verify('SMMP-00000000000000000000000000000000')).toMatchObject({ status: 404, error: 'payment_not_found' });
    expect(count('GET /transaction/verify')).toBe(before);
  });

  it('answers 502 and changes nothing while Paystack is down', async () => {
    const { reference } = await started();
    paystack.pay(reference);
    paystack.setOutage(true);
    expect(await verify(reference)).toMatchObject({ status: 502, error: 'gateway_unavailable' });
    paystack.setOutage(false);
    expect((await payment(reference)).status).toBe('initialized');
    expect(await verify(reference)).toMatchObject({ status: 'confirmed' });
  });

  it('handles a payment that arrives after the hold expired', async () => {
    const free = await started();
    await expire(free.hold.id);
    paystack.pay(free.reference);
    expect(await verify(free.reference)).toMatchObject({ status: 'confirmed' });

    const start = nextSlot();
    const late = await started(await readyHold(start));
    await expire(late.hold.id);
    await readyHold(start); // another guest takes the slot
    paystack.pay(late.reference);
    expect(await verify(late.reference)).toMatchObject({ status: 'refund_required', reason: 'slot_retaken', appointment: null });
  });
});

describe('payments endpoint: transport', () => {
  it('rate-limits, validates the method and body, and applies CORS', async () => {
    const d = deps();
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await pay({ action: 'initialize', holdToken: '00000000-0000-4000-8000-000000000000' }, d)).status);
    expect(statuses).toEqual([...Array(10).fill(410), 429]);

    expect((await handlePaymentsRequest(new Request('https://project.functions.example/payments'), deps())).status).toBe(405);
    expect((await pay('{broken')).status).toBe(400);
    expect((await pay({ action: 'refund', reference: 'x' })).status).toBe(400);
    expect((await pay({ action: 'initialize', padding: 'x'.repeat(5000) })).status).toBe(413);

    const allowed = await pay({ action: 'verify', reference: 'SMMP-00000000000000000000000000000000' });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(SITE);
    const foreign = await pay({ action: 'verify', reference: 'SMMP-00000000000000000000000000000000' }, deps(), {
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    });
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('never leaks internals or the secret key', async () => {
    const res = await pay(
      { action: 'verify', reference: 'SMMP-00000000000000000000000000000000' },
      deps({
        rpc: async (fn) =>
          fn === 'consume_rate_limit' ? { data: true, error: null } : { data: null, error: { code: '42P01', message: `relation "secret" missing ${FAKE_SECRET_KEY}` } },
      }),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"server_error"}');
  });
});

describe('paystack webhook', () => {
  it('books from a correctly signed charge.success after checking the transaction with Paystack', async () => {
    const { hold, reference } = await started();
    paystack.pay(reference);
    const res = await webhook(paystack.chargeSuccessWebhook(reference));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, result: 'confirmed' });
    expect(await appointmentsFor(hold.id)).toHaveLength(1);

    const event = await one(db, `select * from payment_events where event_id = $1`, [`charge.success:${paystack.transactions.get(reference)!.id}`]);
    expect(event.processed_at).not.toBeNull();
    expect(event.payment_id).toBe((await payment(reference)).id);
    const stored = JSON.stringify(event.payload);
    for (const sensitive of ['AUTH_simulated', '4081', '@example.com']) expect(stored).not.toContain(sensitive);
  });

  it('handles duplicate deliveries without duplicate payments or appointments', async () => {
    const { hold, reference } = await started();
    paystack.pay(reference);
    const delivery = paystack.chargeSuccessWebhook(reference);
    const bodies = [];
    for (let i = 0; i < 4; i++) {
      const res = await webhook(delivery);
      expect(res.status).toBe(200);
      bodies.push(await res.json());
    }
    expect(bodies[0]).toEqual({ received: true, result: 'confirmed' });
    expect(bodies.slice(1)).toEqual(Array(3).fill({ received: true, duplicate: true }));
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
    expect(await rows(db, `select id from payments where hold_id = $1`, [hold.id])).toHaveLength(1);
    expect(await rows(db, `select id from payment_events where event_id like $1`, [`charge.success:${paystack.transactions.get(reference)!.id}`])).toHaveLength(1);
  });

  it('works in either order with the browser verify call: one appointment', async () => {
    const first = await started();
    paystack.pay(first.reference);
    await verify(first.reference);
    expect((await (await webhook(paystack.chargeSuccessWebhook(first.reference))).json()).result).toBe('confirmed');
    expect(await appointmentsFor(first.hold.id)).toHaveLength(1);

    const second = await started();
    paystack.pay(second.reference);
    await webhook(paystack.chargeSuccessWebhook(second.reference));
    expect(await verify(second.reference)).toMatchObject({ status: 'confirmed' });
    expect(await appointmentsFor(second.hold.id)).toHaveLength(1);
  });

  it('rejects a missing, wrong or wrong-key signature and stores nothing', async () => {
    const { hold, reference } = await started();
    paystack.pay(reference);
    const good = paystack.chargeSuccessWebhook(reference);
    const events = async () => (await one(db, `select count(*)::int as n from payment_events`)).n;
    const before = await events();

    const missing = await webhook({ body: good.body, headers: { 'content-type': 'application/json' } });
    const wrong = await webhook({ body: good.body, headers: { ...good.headers, 'x-paystack-signature': 'ab'.repeat(64) } });
    const otherKey = await webhook(paystack.webhook('charge.success', JSON.parse(good.body).data, { secret: 'sk_test_attacker' }));
    for (const res of [missing, wrong, otherKey]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_signature' });
    }
    expect(await events()).toBe(before);
    expect((await payment(reference)).status).toBe('initialized');
    expect(await appointmentsFor(hold.id)).toEqual([]);
  });

  it('rejects a body that was altered after signing', async () => {
    const victim = await started();
    const attacker = await started();
    paystack.pay(attacker.reference);
    const signed = paystack.chargeSuccessWebhook(attacker.reference);
    // Re-point the signed event at another booking's reference.
    const tampered = await webhook({ body: signed.body.replace(attacker.reference, victim.reference), headers: signed.headers });
    expect(tampered.status).toBe(401);
    expect(await appointmentsFor(victim.hold.id)).toEqual([]);
  });

  it('accepts POST only', async () => {
    const { reference } = await started();
    paystack.pay(reference);
    const delivery = paystack.chargeSuccessWebhook(reference);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await handleWebhookRequest(
        new Request('https://project.functions.example/paystack-webhook', { method, headers: delivery.headers, body: method === 'GET' ? undefined : delivery.body }),
        { rpc: pgliteRpc(db), gateway },
      );
      expect(res.status).toBe(405);
    }
    expect((await payment(reference)).status).toBe('initialized');
  });

  it('does not trust a signed event that Paystack itself does not confirm', async () => {
    const { hold, reference } = await started(); // never paid at Paystack
    const t = paystack.transactions.get(reference)!;
    const replay = paystack.webhook('charge.success', { id: t.id, reference, amount: t.amount, currency: 'NGN', status: 'success' });
    const res = await webhook(replay);
    expect(res.status).toBe(500); // not acknowledged: Paystack would deliver again
    expect(await appointmentsFor(hold.id)).toEqual([]);
    expect((await payment(reference)).status).toBe('initialized');
  });

  it('uses the amount Paystack verifies, not the amount written in the event', async () => {
    const { hold, reference } = await started();
    const t = paystack.pay(reference, { amount: 500 });
    const flattering = paystack.webhook('charge.success', { id: t.id, reference, amount: PRICE, currency: 'NGN', status: 'success' });
    expect((await (await webhook(flattering)).json()).result).toBe('refund_required');
    expect(await payment(reference)).toMatchObject({ needs_refund: true, needs_refund_reason: 'amount_mismatch' });
    expect(Number((await payment(reference)).paid_minor)).toBe(500);
    expect(await appointmentsFor(hold.id)).toEqual([]);
  });

  it('is not acknowledged while processing cannot complete, and succeeds on redelivery', async () => {
    const { hold, reference } = await started();
    paystack.pay(reference);
    const delivery = paystack.chargeSuccessWebhook(reference);
    const eventId = `charge.success:${paystack.transactions.get(reference)!.id}`;

    paystack.setOutage(true);
    const during = await webhook(delivery);
    paystack.setOutage(false);
    expect(during.status).toBe(500);
    expect(await one(db, `select processed_at, processing_error from payment_events where event_id = $1`, [eventId])).toMatchObject({ processed_at: null });
    expect(await appointmentsFor(hold.id)).toEqual([]);

    const redelivered = await webhook(delivery);
    expect(redelivered.status).toBe(200);
    expect(await redelivered.json()).toEqual({ received: true, result: 'confirmed' });
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
    expect(await one(db, `select processing_error from payment_events where event_id = $1`, [eventId])).toEqual({ processing_error: null });
  });

  it('flags a refund when the paid-for slot was retaken', async () => {
    const start = nextSlot();
    const late = await started(await readyHold(start));
    await expire(late.hold.id);
    const other = await readyHold(start);
    paystack.pay(late.reference);
    expect((await (await webhook(paystack.chargeSuccessWebhook(late.reference))).json()).result).toBe('refund_required');
    expect(await payment(late.reference)).toMatchObject({ status: 'succeeded', needs_refund: true, needs_refund_reason: 'slot_retaken' });
    expect((await one(db, `select status from booking_holds where id = $1`, [other.id])).status).toBe('active');
  });

  it('records Paystack refund events and never initiates a refund itself', async () => {
    const { reference } = await started();
    paystack.pay(reference);
    await verify(reference);
    const requestsBefore = paystack.requests.length;
    const refundEvent = (event: string, status: string) =>
      webhook(paystack.webhook(event, { status, transaction_reference: reference, refund_reference: 'RF-100', amount: PRICE, currency: 'NGN', merchant_note: 'Customer cancelled' }));

    expect((await (await refundEvent('refund.pending', 'pending')).json()).result).toBe('refund_recorded');
    expect(await payment(reference)).toMatchObject({ refund_status: 'pending', refund_reference: 'RF-100', refund_reason: 'Customer cancelled', status: 'succeeded' });
    await refundEvent('refund.processing', 'processing');
    expect((await payment(reference)).refund_status).toBe('processing');
    await refundEvent('refund.processed', 'processed');
    await refundEvent('refund.processed', 'processed'); // duplicate delivery
    const refunded = await payment(reference);
    expect(refunded).toMatchObject({ refund_status: 'processed', status: 'refunded' });
    expect(Number(refunded.refunded_minor)).toBe(PRICE);

    const failed = await started();
    paystack.pay(failed.reference);
    await verify(failed.reference);
    await webhook(paystack.webhook('refund.failed', { status: 'failed', transaction_reference: failed.reference, refund_reference: 'RF-200', amount: PRICE }));
    expect(await payment(failed.reference)).toMatchObject({ refund_status: 'failed', status: 'succeeded' });
    expect((await payment(failed.reference)).refund_error).not.toBeNull();

    // No call to Paystack's refund API was made by any of this.
    expect(paystack.requests.slice(requestsBefore).filter((r) => r.includes('/refund'))).toEqual([]);
  });

  it('records refund.needs-attention, idempotently, and a later processed event still completes the refund', async () => {
    const { reference } = await started();
    paystack.pay(reference);
    await verify(reference);
    const event = (name: string, status: string) =>
      paystack.webhook(name, { status, transaction_reference: reference, refund_reference: 'RF-300', amount: PRICE, currency: 'NGN', merchant_note: 'Bank could not process' });

    const attention = event('refund.needs-attention', 'needs-attention');
    const first = await webhook(attention);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true, result: 'refund_recorded' });
    const flagged = await payment(reference);
    expect(flagged).toMatchObject({ refund_status: 'needs_attention', refund_reference: 'RF-300', refund_error: 'Bank could not process', status: 'succeeded' });
    expect(Number(flagged.refunded_minor)).toBe(0);
    expect(Number(flagged.refundable_minor)).toBe(PRICE);
    const requestedAt = flagged.refund_requested_at;

    // The same delivery again, twice: acknowledged, nothing changes.
    for (let i = 0; i < 2; i++) expect(await (await webhook(attention)).json()).toEqual({ received: true, duplicate: true });
    const after = await payment(reference);
    expect(after).toMatchObject({ refund_status: 'needs_attention', refund_error: 'Bank could not process' });
    expect(after.refund_requested_at).toEqual(requestedAt);
    expect(await rows(db, `select id from payment_events where event_id = 'refund.needs-attention:RF-300'`)).toHaveLength(1);

    // Once Paystack resolves it, the refund completes and the error is cleared.
    await webhook(event('refund.processed', 'processed'));
    const done = await payment(reference);
    expect(done).toMatchObject({ refund_status: 'processed', status: 'refunded', refund_error: null });
    expect(Number(done.refunded_minor)).toBe(PRICE);
  });

  it('does not book when a scheduling rule changed after the slot was held', async () => {
    const start = nextSlot();
    const viaVerify = await started(await readyHold(start));
    const { id } = await one(db, `insert into therapist_time_off (therapist_id, starts_at, ends_at) values ($1, $2, $3) returning id`, [
      A, start.toISOString(), new Date(start.getTime() + 3_600_000).toISOString(),
    ]);
    paystack.pay(viaVerify.reference);
    expect(await verify(viaVerify.reference)).toMatchObject({ status: 'refund_required', reason: 'schedule_changed', appointment: null });
    expect((await (await webhook(paystack.chargeSuccessWebhook(viaVerify.reference))).json()).result).toBe('refund_required');
    expect(await payment(viaVerify.reference)).toMatchObject({ needs_refund: true, needs_refund_reason: 'schedule_changed', needs_refund_detail: 'time_off' });
    expect(await appointmentsFor(viaVerify.hold.id)).toEqual([]);
    await db.query(`delete from therapist_time_off where id = $1`, [id]);
  });

  it('acknowledges events it has no use for, and transactions it did not start', async () => {
    const other = await webhook(paystack.webhook('transfer.success', { id: 555, reference: 'TRF-1' }));
    expect(await other.json()).toEqual({ received: true, result: 'ignored' });

    // A genuine sale on the same Paystack account that this system did not start.
    await gateway.initialize({ reference: 'OTHER-SALE-1', amountMinor: 1000, currency: 'NGN', email: 'someone@example.com' });
    paystack.pay('OTHER-SALE-1');
    const foreign = await webhook(paystack.chargeSuccessWebhook('OTHER-SALE-1'));
    expect(await foreign.json()).toEqual({ received: true, result: 'unknown_reference' });
    expect(await rows(db, `select id from payments where provider_reference = 'OTHER-SALE-1'`)).toEqual([]);
  });

  it('rejects signed bodies that are not valid events, and oversized bodies', async () => {
    const garbage = paystack.webhook('charge.success', {});
    expect((await webhook(garbage)).status).toBe(400);
    expect((await webhook({ body: 'x'.repeat(70_000), headers: { 'x-paystack-signature': 'ab' } })).status).toBe(413);
  });
});
