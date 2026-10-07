import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { handlePaymentsRequest } from '../../supabase/functions/payments/handler';
import { handleWebhookRequest } from '../../supabase/functions/paystack-webhook/handler';
import { at, upcoming } from '../db/dates';
import { asRole, createTestDb, one, rows } from '../db/harness';
import { mockDriver, paystackDriver, type Delivery, type PaymentDriver } from '../support/payment-drivers';
import { pgliteRpc } from '../support/rpc';

// The same scenarios against both payment gateways. Passing for both shows the
// demo gateway exercises exactly the booking and payment invariants that the
// Paystack adapter will: swapping one for the other changes no domain logic.

const PRICE = 4_000_000;
const SITE = 'http://localhost:3000';
let db: PGlite;
let swedish: string;
let A: string;
const drivers: PaymentDriver[] = [];

let slotIndex = 0;
const TIMES = ['09:00', '11:00', '14:00', '16:00', '18:00'];
function nextSlot(): Date {
  const i = slotIndex++;
  return at(upcoming(1 + (Math.floor(i / TIMES.length) % 6), Math.floor(i / (TIMES.length * 6))), TIMES[i % TIMES.length]);
}

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`delete from appointments`);
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  A = (await one(db, `select id from therapists where sort_order = 1`)).id;
  drivers.push(await paystackDriver(), await mockDriver(db));
});
afterAll(async () => {
  for (const d of drivers) await d.close();
});

describe.each([0, 1])('payment gateway contract #%i', (index) => {
  const driver = () => drivers[index];
  let visitor = 0;
  const deps = () => ({ rpc: pgliteRpc(db), gateway: driver().gateway, clientKey: async () => `contract-${index}-${++visitor}`, allowedOrigins: [SITE] });
  const call = async (body: unknown) => {
    const res = await handlePaymentsRequest(new Request('https://fn/payments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), deps());
    return { http: res.status, ...(await res.json()) };
  };
  const webhook = async (delivery: Delivery) =>
    handleWebhookRequest(new Request('https://fn/webhook', { method: 'POST', headers: delivery.headers, body: delivery.body }), { rpc: pgliteRpc(db), gateway: driver().gateway });

  let guest = 0;
  async function started(start = nextSlot()) {
    const rpc = pgliteRpc(db);
    const hold = (await rpc('request_booking_hold', { p_service_id: swedish, p_starts_at: start.toISOString(), p_therapist_id: A })).data;
    await rpc('attach_customer_to_hold', { p_hold_token: hold.hold_token, p_full_name: 'Contract Guest', p_email: `contract${index}-${++guest}@example.com`, p_phone: '+2348000000000' });
    const init = await call({ action: 'initialize', holdToken: hold.hold_token, callbackUrl: `${SITE}/?view=payment-return`, amountMinor: 1 });
    return { hold, init, reference: init.reference as string };
  }
  const verify = (reference: string, extra = {}) => call({ action: 'verify', reference, ...extra });
  const appointmentsFor = (holdId: string) => rows(db, `select * from appointments where hold_id = $1`, [holdId]);
  const payment = (reference: string) => one(db, `select * from payments where provider_reference = $1`, [reference]);
  const expire = (holdId: string) => db.query(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [holdId]);

  it('starts a payment for the server-calculated amount and labels demo payments as such', async () => {
    const { init, reference } = await started();
    expect(init).toMatchObject({ http: 200, amountMinor: PRICE, currency: 'NGN', provider: driver().gateway.name, demo: driver().gateway.name === 'mock' });
    expect(await payment(reference)).toMatchObject({ provider: driver().gateway.name, status: 'initialized', is_test: true, is_demo: driver().gateway.name === 'mock' });
    if (driver().gateway.name === 'mock') expect(init.checkoutUrl).toBe(`${SITE}/?view=demo-checkout&reference=${reference}`);
  });

  it('confirms only after the provider reports payment; the browser cannot claim it', async () => {
    const { hold, reference } = await started();
    expect(await verify(reference, { status: 'success', amountMinor: PRICE })).toMatchObject({ status: 'pending', appointment: null });
    await driver().pay(reference);
    const confirmed = await verify(reference);
    expect(confirmed).toMatchObject({ status: 'confirmed', demo: driver().gateway.name === 'mock' });
    const [appointment] = await appointmentsFor(hold.id);
    expect(confirmed.appointment.reference).toBe(appointment.reference);
    expect(appointment.is_demo).toBe(driver().gateway.name === 'mock');
  });

  it('turns duplicate notifications and repeated verifies into exactly one appointment', async () => {
    const { hold, reference } = await started();
    await driver().pay(reference);
    const delivery = await driver().successEvent(reference);
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await webhook(delivery)).status);
    await verify(reference);
    await verify(reference);
    expect(statuses).toEqual([200, 200, 200]);
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
    expect(await rows(db, `select id from payments where hold_id = $1`, [hold.id])).toHaveLength(1);
  });

  it('rejects notifications not signed by the provider', async () => {
    const { hold, reference } = await started();
    await driver().pay(reference);
    const res = await webhook(await driver().forgedEvent(reference));
    expect(res.status).toBe(401);
    expect(await appointmentsFor(hold.id)).toEqual([]);
    expect((await payment(reference)).status).toBe('initialized');
  });

  it('records a declined payment without booking, and a retry can succeed', async () => {
    const { hold, reference } = await started();
    await driver().decline(reference);
    expect(await verify(reference)).toMatchObject({ status: 'failed', appointment: null });
    expect(await appointmentsFor(hold.id)).toEqual([]);

    const retry = await call({ action: 'initialize', holdToken: hold.hold_token, callbackUrl: `${SITE}/?view=payment-return` });
    expect(retry.reference).not.toBe(reference);
    await driver().pay(retry.reference);
    expect(await verify(retry.reference)).toMatchObject({ status: 'confirmed' });
  });

  it('keeps a pending payment pending until it is confirmed', async () => {
    const { hold, reference } = await started();
    await driver().setPending(reference);
    expect(await verify(reference)).toMatchObject({ status: 'pending' });
    expect(await appointmentsFor(hold.id)).toEqual([]);
    await driver().pay(reference);
    expect(await verify(reference)).toMatchObject({ status: 'confirmed' });
  });

  it('marks an unpaid payment abandoned after 30 minutes, and still honours a late genuine payment', async () => {
    const { hold, reference } = await started();
    await db.query(`update payments set created_at = now() - interval '31 minutes' where provider_reference = $1`, [reference]);
    await expire(hold.id);
    await asRole(db, 'service_role', null, () => db.query(`select run_booking_maintenance()`));
    expect((await payment(reference)).status).toBe('abandoned');

    await driver().pay(reference);
    expect(await verify(reference)).toMatchObject({ status: 'confirmed' });
  });

  it('flags a late payment for refund when the slot was retaken', async () => {
    const start = nextSlot();
    const late = await started(start);
    await expire(late.hold.id);
    await started(start); // another guest holds the slot now
    await driver().pay(late.reference);
    expect(await verify(late.reference)).toMatchObject({ status: 'refund_required', reason: 'slot_retaken', appointment: null });
  });

  it('flags a payment for refund when a scheduling rule changed after the hold', async () => {
    const start = nextSlot();
    const p = await started(start);
    const { id } = await one(db, `insert into therapist_time_off (therapist_id, starts_at, ends_at) values ($1, $2, $3) returning id`, [A, start.toISOString(), new Date(start.getTime() + 3_600_000).toISOString()]);
    await driver().pay(p.reference);
    expect(await verify(p.reference)).toMatchObject({ status: 'refund_required', reason: 'schedule_changed' });
    expect((await payment(p.reference)).needs_refund_detail).toBe('time_off');
    await db.query(`delete from therapist_time_off where id = $1`, [id]);
  });

  it('refuses to book when the provider reports a different amount', async () => {
    const { hold, reference } = await started();
    await driver().pay(reference, 100);
    expect(await verify(reference)).toMatchObject({ status: 'refund_required', reason: 'amount_mismatch' });
    expect(await appointmentsFor(hold.id)).toEqual([]);
  });

  it('records provider refund events', async () => {
    const { reference } = await started();
    await driver().pay(reference);
    await verify(reference);
    const res = await webhook(await driver().event('refund.processed', { status: 'processed', transaction_reference: reference, refund_reference: `RF-${index}`, amount: PRICE, currency: 'NGN' }));
    expect(res.status).toBe(200);
    expect(await payment(reference)).toMatchObject({ refund_status: 'processed', status: 'refunded' });
  });
});
