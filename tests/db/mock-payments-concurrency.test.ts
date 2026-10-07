import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleDemoCheckoutRequest } from '../../supabase/functions/demo-checkout/handler';
import { MockPaymentGateway } from '../../supabase/functions/_shared/payments/mock';
import { handlePaymentsRequest } from '../../supabase/functions/payments/handler';
import { handleWebhookRequest } from '../../supabase/functions/paystack-webhook/handler';
import { startRealPostgres, type RealPostgres } from '../support/real-postgres';
import { pgRpc } from '../support/rpc';
import { at, upcoming } from './dates';

// Demo-payment races on a real PostgreSQL server, each call on its own
// connection: the demo gateway must hold the same concurrency guarantees as
// the Paystack path.

const N = 16;
let database: RealPostgres;
let pool: pg.Pool;
let gateway: MockPaymentGateway;
let swedish: string;
let A: string;

let slotIndex = 0;
const TIMES = ['09:00', '11:00', '14:00', '16:00', '18:00'];
function nextSlot(): Date {
  const i = slotIndex++;
  return at(upcoming(1 + (Math.floor(i / TIMES.length) % 6), Math.floor(i / (TIMES.length * 6))), TIMES[i % TIMES.length]);
}
const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

let visitor = 0;
const common = () => ({ rpc: pgRpc(pool), allowedOrigins: ['http://localhost:3000'], clientKey: async () => `race-${++visitor}` });
const post = (body: unknown) => new Request('http://fn/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const payments = (body: unknown) => handlePaymentsRequest(post(body), { ...common(), gateway });
const demoCheckout = (body: unknown) =>
  handleDemoCheckoutRequest(post(body), {
    ...common(),
    gateway,
    deliverWebhook: async ({ body: raw, headers }) =>
      (await handleWebhookRequest(new Request('http://fn/webhook', { method: 'POST', headers, body: raw }), { rpc: pgRpc(pool), gateway })).status,
  });

let guest = 0;
async function started(start = nextSlot()) {
  const [hold] = await q(`select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), A]);
  await q(`select attach_customer_to_hold($1, 'Race Guest', $2, '+2348000000000')`, [hold.hold_token, `mockrace${++guest}@example.com`]);
  const init = await (await payments({ action: 'initialize', holdToken: hold.hold_token, callbackUrl: 'http://localhost:3000/?view=payment-return' })).json();
  return { hold, reference: init.reference as string };
}

beforeAll(async () => {
  database = await startRealPostgres(N * 3 + 4);
  pool = database.pool;
  gateway = new MockPaymentGateway({ rpc: pgRpc(pool), webhookSecret: 'race-demo-secret' });
  swedish = (await q(`select id from services where slug = 'swedish'`))[0].id;
  A = (await q(`select id from therapists where sort_order = 1`))[0].id;
}, 180_000);
afterAll(async () => {
  await database?.stop();
});

describe('demo payment races (real PostgreSQL, separate connections)', () => {
  it(`${N} simultaneous "pay" clicks with duplicate notifications, racing ${N} verifies: one appointment`, async () => {
    const { hold, reference } = await started();
    const calls = [
      ...Array.from({ length: N }, () => demoCheckout({ action: 'complete', reference, outcome: 'success', deliveries: 2 })),
      ...Array.from({ length: N }, () => payments({ action: 'verify', reference })),
    ];
    const responses = await Promise.all(calls);
    expect(responses.map((r) => r.status)).toEqual(Array(2 * N).fill(200));
    expect(await q(`select id from appointments where hold_id = $1`, [hold.id])).toHaveLength(1);
    expect(await q(`select id from payments where hold_id = $1`, [hold.id])).toHaveLength(1);
    expect(await q(`select status from payments where provider_reference = $1`, [reference])).toEqual([{ status: 'succeeded' }]);
  });

  it('a late demo payment racing a new guest for the same slot: exactly one wins, every round', async () => {
    const rounds = 8;
    for (let round = 0; round < rounds; round++) {
      const start = nextSlot();
      const { hold, reference } = await started(start);
      await q(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [hold.id]);

      const [paid, newcomer] = await Promise.allSettled([
        demoCheckout({ action: 'complete', reference, outcome: 'success' }),
        pool.query(`select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), A]),
      ]);
      expect(paid.status).toBe('fulfilled');
      const outcome = await (await payments({ action: 'verify', reference })).json();
      const booked = (await q(`select id from appointments where hold_id = $1`, [hold.id])).length;
      if (newcomer.status === 'fulfilled') {
        expect(outcome).toMatchObject({ status: 'refund_required', reason: 'slot_retaken' });
        expect(booked).toBe(0);
      } else {
        expect((newcomer as PromiseRejectedResult).reason.message).toBe('slot_unavailable');
        expect(outcome.status).toBe('confirmed');
        expect(booked).toBe(1);
      }
    }
  });
});
