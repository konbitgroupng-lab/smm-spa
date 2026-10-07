import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { handleDemoCheckoutRequest, type DemoCheckoutDeps } from '../../supabase/functions/demo-checkout/handler';
import { createPaymentGateway } from '../../supabase/functions/_shared/payments/factory';
import { GatewayError } from '../../supabase/functions/_shared/payments/gateway';
import { MockPaymentGateway } from '../../supabase/functions/_shared/payments/mock';
import { PaystackAdapter } from '../../supabase/functions/_shared/payments/paystack';
import { handlePaymentsRequest } from '../../supabase/functions/payments/handler';
import { handleWebhookRequest } from '../../supabase/functions/paystack-webhook/handler';
import { at, upcoming } from '../db/dates';
import { asRole, createTestDb, one, rows } from '../db/harness';
import { pgliteRpc } from '../support/rpc';

// The simulated provider's checkout backend, and the configuration switch
// between the demo gateway and Paystack.

const PRICE = 4_000_000;
const SITE = 'http://localhost:3000';
let db: PGlite;
let gateway: MockPaymentGateway;
let swedish: string;
let A: string;
let webhookDeliveries: number[] = [];

let slotIndex = 0;
const TIMES = ['09:00', '11:00', '14:00', '16:00', '18:00'];
function nextSlot(): Date {
  const i = slotIndex++;
  return at(upcoming(1 + (Math.floor(i / TIMES.length) % 6), Math.floor(i / (TIMES.length * 6))), TIMES[i % TIMES.length]);
}

let visitor = 0;
function deps(overrides: Partial<DemoCheckoutDeps> = {}): DemoCheckoutDeps {
  const key = `demo-${++visitor}`;
  return {
    rpc: pgliteRpc(db),
    gateway,
    deliverWebhook: async ({ body, headers }) => {
      const status = (await handleWebhookRequest(new Request('https://internal/webhook', { method: 'POST', headers, body }), { rpc: pgliteRpc(db), gateway })).status;
      webhookDeliveries.push(status);
      return status;
    },
    clientKey: async () => key,
    allowedOrigins: [SITE],
    ...overrides,
  };
}
const checkout = async (body: unknown, d = deps()) => {
  const res = await handleDemoCheckoutRequest(new Request('https://fn/demo-checkout', { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE }, body: JSON.stringify(body) }), d);
  return { http: res.status, ...(await res.json()) };
};
const payments = async (body: unknown) => {
  const res = await handlePaymentsRequest(new Request('https://fn/payments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), {
    rpc: pgliteRpc(db), gateway, clientKey: async () => `pay-${++visitor}`, allowedOrigins: [SITE],
  });
  return { http: res.status, ...(await res.json()) };
};

let guest = 0;
async function started(start = nextSlot()) {
  const rpc = pgliteRpc(db);
  const hold = (await rpc('request_booking_hold', { p_service_id: swedish, p_starts_at: start.toISOString(), p_therapist_id: A })).data;
  await rpc('attach_customer_to_hold', { p_hold_token: hold.hold_token, p_full_name: 'Demo Guest', p_email: `demo.guest${++guest}@example.com`, p_phone: '+2348000000000' });
  const init = await payments({ action: 'initialize', holdToken: hold.hold_token, callbackUrl: `${SITE}/?view=payment-return` });
  return { hold, init, reference: init.reference as string };
}
const appointmentsFor = (holdId: string) => rows(db, `select * from appointments where hold_id = $1`, [holdId]);
const payment = (reference: string) => one(db, `select * from payments where provider_reference = $1`, [reference]);

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`delete from appointments`);
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  A = (await one(db, `select id from therapists where sort_order = 1`)).id;
  gateway = new MockPaymentGateway({ rpc: pgliteRpc(db), webhookSecret: 'test-demo-webhook-secret' });
});

describe('demo checkout: the guest journey', () => {
  it('shows the server-set amount, a masked email and the demo flag', async () => {
    const { reference, init } = await started();
    expect(init).toMatchObject({ provider: 'mock', demo: true, amountMinor: PRICE });
    expect(init.checkoutUrl).toBe(`${SITE}/?view=demo-checkout&reference=${reference}`);
    const view = await checkout({ action: 'get', reference });
    expect(view).toEqual({ http: 200, demo: true, reference, amountMinor: PRICE, currency: 'NGN', status: 'abandoned', email: expect.stringMatching(/^d\*\*\*@example\.com$/), canReturn: true });
  });

  it('a successful demo payment books through the webhook path and returns the guest with the reference', async () => {
    const { hold, reference } = await started();
    webhookDeliveries = [];
    const done = await checkout({ action: 'complete', reference, outcome: 'success' });
    expect(done).toMatchObject({ http: 200, status: 'success', webhookStatus: 200 });
    expect(webhookDeliveries).toEqual([200]);
    const back = new URL(done.returnUrl);
    expect(back.origin).toBe(SITE);
    expect(back.searchParams.get('view')).toBe('payment-return');
    expect(back.searchParams.get('reference')).toBe(reference);
    expect(back.searchParams.get('trxref')).toBe(reference);

    const [appointment] = await appointmentsFor(hold.id);
    expect(appointment).toMatchObject({ status: 'confirmed', is_demo: true });
    expect(await payment(reference)).toMatchObject({ status: 'succeeded', provider: 'mock', is_demo: true, is_test: true, appointment_id: appointment.id });
    expect(await payments({ action: 'verify', reference })).toMatchObject({ status: 'confirmed', demo: true });
  });

  it('a duplicated provider notification still books once', async () => {
    const { hold, reference } = await started();
    webhookDeliveries = [];
    await checkout({ action: 'complete', reference, outcome: 'success', deliveries: 3 });
    expect(webhookDeliveries).toEqual([200, 200, 200]);
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
    expect(await rows(db, `select id from payment_events where provider = 'mock' and payment_id = (select id from payments where provider_reference = $1)`, [reference])).toHaveLength(1);
  });

  it('a declined demo card books nothing; verify reports it failed; the guest can pay on the same page again', async () => {
    const { hold, reference } = await started();
    webhookDeliveries = [];
    expect(await checkout({ action: 'complete', reference, outcome: 'decline' })).toMatchObject({ status: 'failed', webhookStatus: null });
    expect(webhookDeliveries).toEqual([]); // providers do not notify failures
    expect(await payments({ action: 'verify', reference })).toMatchObject({ status: 'failed' });
    expect(await appointmentsFor(hold.id)).toEqual([]);

    // Paying on the same checkout after a decline, as a guest can at a real provider.
    expect(await checkout({ action: 'complete', reference, outcome: 'success' })).toMatchObject({ status: 'success' });
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
  });

  it('a pending bank transfer books nothing until it completes', async () => {
    const { hold, reference } = await started();
    expect(await checkout({ action: 'complete', reference, outcome: 'pending' })).toMatchObject({ status: 'pending' });
    expect(await payments({ action: 'verify', reference })).toMatchObject({ status: 'pending' });
    expect(await appointmentsFor(hold.id)).toEqual([]);
  });

  it('cancelling returns the guest without recording a payment', async () => {
    const { hold, reference } = await started();
    const back = await checkout({ action: 'cancel', reference });
    expect(back).toMatchObject({ http: 200, status: 'abandoned' });
    expect(new URL(back.returnUrl).searchParams.get('reference')).toBe(reference);
    expect(await payments({ action: 'verify', reference })).toMatchObject({ status: 'pending' });
    expect((await payment(reference)).status).toBe('initialized');
    expect(await appointmentsFor(hold.id)).toEqual([]);
  });

  it('a payment completed after the slot was retaken is flagged for refund, not booked', async () => {
    const start = nextSlot();
    const late = await started(start);
    await db.query(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [late.hold.id]);
    await started(start);
    await checkout({ action: 'complete', reference: late.reference, outcome: 'success' });
    expect(await payments({ action: 'verify', reference: late.reference })).toMatchObject({ status: 'refund_required', reason: 'slot_retaken' });
    expect(await appointmentsFor(late.hold.id)).toEqual([]);
  });
});

describe('demo checkout: boundaries', () => {
  it('cannot change the amount or anything but the outcome', async () => {
    const { hold, reference } = await started();
    await checkout({ action: 'complete', reference, outcome: 'success', amount: 1, amountMinor: 1, currency: 'USD', status: 'success' });
    const [appointment] = await appointmentsFor(hold.id);
    expect(Number(appointment.total_minor)).toBe(PRICE);
    expect(Number((await payment(reference)).paid_minor)).toBe(PRICE);
  });

  it('validates input and rate-limits', async () => {
    const { reference } = await started();
    expect(await checkout({ action: 'complete', reference, outcome: 'refund' })).toMatchObject({ http: 400, field: 'outcome' });
    expect(await checkout({ action: 'complete', reference, outcome: 'success', deliveries: 50 })).toMatchObject({ http: 400, field: 'deliveries' });
    expect(await checkout({ action: 'get', reference: 'x' })).toMatchObject({ http: 400, field: 'reference' });
    expect(await checkout({ action: 'delete', reference })).toMatchObject({ http: 400, field: 'action' });
    expect(await checkout({ action: 'get', reference: 'SMMP-DOESNOTEXIST0000' })).toMatchObject({ http: 404, error: 'transaction_not_found' });
    const res = await handleDemoCheckoutRequest(new Request('https://fn/demo-checkout'), deps());
    expect(res.status).toBe(405);

    const d = deps();
    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await checkout({ action: 'cancel', reference }, d)).http);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('is unavailable unless the configured gateway is the demo gateway', async () => {
    const { reference } = await started();
    const paystack = new PaystackAdapter('sk_test_never_called');
    for (const action of ['get', 'complete', 'cancel']) {
      expect(await checkout({ action, reference, outcome: 'success' }, deps({ gateway: paystack }))).toMatchObject({ http: 404, error: 'not_available' });
    }
    expect((await payment(reference)).status).toBe('initialized');
  });

  it('demo payments are refused when the database has not opted in', async () => {
    await db.query(`update business_settings set allow_demo_payments = false`);
    try {
      const rpc = pgliteRpc(db);
      const hold = (await rpc('request_booking_hold', { p_service_id: swedish, p_starts_at: nextSlot().toISOString(), p_therapist_id: A })).data;
      await rpc('attach_customer_to_hold', { p_hold_token: hold.hold_token, p_full_name: 'Demo Guest', p_email: 'optin@example.com', p_phone: '+2348000000000' });
      expect(await payments({ action: 'initialize', holdToken: hold.hold_token, callbackUrl: `${SITE}/` })).toMatchObject({ http: 503, error: 'demo_payments_disabled' });
      expect(await rows(db, `select id from payments where hold_id = $1`, [hold.id])).toEqual([]);
      const direct = await rpc('mock_provider_initialize', { p_reference: 'SMMP-OPTIN-TEST-1', p_amount_minor: 100, p_currency: 'NGN', p_email: 'a@example.com' });
      expect(direct.error?.message).toBe('demo_payments_disabled');
      // A real provider is unaffected by the switch.
      const real = await rpc('begin_hold_payment', { p_hold_token: hold.hold_token, p_provider: 'paystack', p_is_test: true });
      expect(real.error).toBeNull();
    } finally {
      await db.query(`update business_settings set allow_demo_payments = true`);
    }
  });

  it('guests and signed-in users cannot reach the simulated provider', async () => {
    const { reference } = await started();
    for (const call of [
      `select mock_provider_initialize('X-REF-123456', 100, 'NGN', 'a@example.com')`,
      `select mock_provider_get('${reference}')`,
      `select mock_provider_complete('${reference}', 'success')`,
      `select * from mock_provider.transactions`,
    ]) {
      await expect(asRole(db, 'anon', null, () => db.query(call))).rejects.toThrow(/permission denied/);
      await expect(asRole(db, 'authenticated', null, () => db.query(call))).rejects.toThrow(/permission denied/);
    }
    expect((await payment(reference)).status).toBe('initialized');
  });
});

describe('demo gateway configuration', () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name];

  it('requires PAYMENT_PROVIDER to be set explicitly', async () => {
    await expect(createPaymentGateway(env({}), pgliteRpc(db))).rejects.toThrow(/PAYMENT_PROVIDER/);
    await expect(createPaymentGateway(env({ PAYMENT_PROVIDER: 'free' }), pgliteRpc(db))).rejects.toThrow(/PAYMENT_PROVIDER/);
  });

  it('builds the demo gateway (always test mode) or the Paystack adapter (which needs its key)', async () => {
    const demo = await createPaymentGateway(env({ PAYMENT_PROVIDER: 'mock', SUPABASE_SERVICE_ROLE_KEY: 'service-key' }), pgliteRpc(db));
    expect(demo).toBeInstanceOf(MockPaymentGateway);
    expect(demo.isTestMode).toBe(true);
    await expect(createPaymentGateway(env({ PAYMENT_PROVIDER: 'mock' }), pgliteRpc(db))).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);

    const paystack = await createPaymentGateway(env({ PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: 'sk_test_abc' }), pgliteRpc(db));
    expect(paystack).toBeInstanceOf(PaystackAdapter);
    await expect(createPaymentGateway(env({ PAYMENT_PROVIDER: 'paystack' }), pgliteRpc(db))).rejects.toThrow(/secret key/);
  });

  it('two functions configured alike agree on the demo webhook signature', async () => {
    const vars = env({ PAYMENT_PROVIDER: 'mock', SUPABASE_SERVICE_ROLE_KEY: 'service-key' });
    const signer = (await createPaymentGateway(vars, pgliteRpc(db))) as MockPaymentGateway;
    const receiver = await createPaymentGateway(vars, pgliteRpc(db));
    const other = await createPaymentGateway(env({ PAYMENT_PROVIDER: 'mock', SUPABASE_SERVICE_ROLE_KEY: 'another-project' }), pgliteRpc(db));
    const delivery = await signer.signedEvent('charge.success', { id: 1, reference: 'R-12345678' });
    expect(await receiver.verifyWebhookSignature(delivery.body, new Headers(delivery.headers))).toBe(true);
    expect(await other.verifyWebhookSignature(delivery.body, new Headers(delivery.headers))).toBe(false);
  });

  it('uses DEMO_CHECKOUT_URL when set, otherwise the return address\'s site, and refuses with neither', async () => {
    const configured = new MockPaymentGateway({ rpc: pgliteRpc(db), webhookSecret: 's', checkoutBaseUrl: 'https://dev.example/pay' });
    expect((await configured.initialize({ reference: 'SMMP-CFG-0000001', amountMinor: 100, currency: 'NGN', email: 'a@example.com' })).checkoutUrl)
      .toBe('https://dev.example/pay?view=demo-checkout&reference=SMMP-CFG-0000001');
    const derived = new MockPaymentGateway({ rpc: pgliteRpc(db), webhookSecret: 's' });
    expect((await derived.initialize({ reference: 'SMMP-CFG-0000002', amountMinor: 100, currency: 'NGN', email: 'a@example.com', callbackUrl: `${SITE}/?view=payment-return` })).checkoutUrl)
      .toBe(`${SITE}/?view=demo-checkout&reference=SMMP-CFG-0000002`);
    await expect(derived.initialize({ reference: 'SMMP-CFG-0000003', amountMinor: 100, currency: 'NGN', email: 'a@example.com' })).rejects.toBeInstanceOf(GatewayError);
    await expect(configured.initialize({ reference: 'SMMP-CFG-0000001', amountMinor: 100, currency: 'NGN', email: 'a@example.com' })).rejects.toBeInstanceOf(GatewayError); // duplicate reference
  });
});
