import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaystackAdapter } from '../../supabase/functions/_shared/payments/paystack';
import { handlePaymentsRequest } from '../../supabase/functions/payments/handler';
import { handleWebhookRequest } from '../../supabase/functions/paystack-webhook/handler';
import { FAKE_SECRET_KEY, startFakePaystack, type FakePaystack } from '../support/fake-paystack';
import { startRealPostgres, type RealPostgres } from '../support/real-postgres';
import { pgRpc } from '../support/rpc';
import { at, upcoming } from './dates';

// Payment races on a real PostgreSQL server, every call on its own connection:
// duplicate webhooks, webhook against verify, and a late payment against a new
// guest wanting the same slot.

const N = 20;
const PRICE = 4_000_000;
let database: RealPostgres;
let pool: pg.Pool;
let paystack: FakePaystack;
let gateway: PaystackAdapter;
let swedish: string;
let A: string;

let slotIndex = 0;
const TIMES = ['09:00', '11:00', '14:00', '16:00', '18:00'];
function nextSlot(): Date {
  const i = slotIndex++;
  return at(upcoming(1 + (Math.floor(i / TIMES.length) % 6), Math.floor(i / (TIMES.length * 6))), TIMES[i % TIMES.length]);
}

const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
let guest = 0;
async function readyHold(start = nextSlot()) {
  const [hold] = await q(`select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), A]);
  await q(`select attach_customer_to_hold($1, 'Test Guest', $2, '+2348000000000')`, [hold.hold_token, `race${++guest}@example.com`]);
  return hold;
}
/** A hold with a payment initialised at the simulated Paystack. */
async function started(start = nextSlot()) {
  const hold = await readyHold(start);
  const [{ r }] = await q(`select begin_hold_payment($1, 'paystack', true) as r`, [hold.hold_token]);
  await gateway.initialize({ reference: r.reference, amountMinor: r.amount_minor, currency: r.currency, email: r.email });
  return { hold, reference: r.reference as string };
}
const recordSuccess = (reference: string) =>
  pool.query(`select record_payment_result('paystack', $1, 'success', $2, 'NGN', now(), 'TX', 'card') as r`, [reference, PRICE]);
const appointmentsFor = (holdId: string) => q(`select id from appointments where hold_id = $1`, [holdId]);
const expire = (holdId: string) => q(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [holdId]);

const webhookRequest = (reference: string) => {
  const delivery = paystack.chargeSuccessWebhook(reference);
  return handleWebhookRequest(new Request('https://fn.example/paystack-webhook', { method: 'POST', headers: delivery.headers, body: delivery.body }), {
    rpc: pgRpc(pool),
    gateway,
  });
};
let visitor = 0;
const verifyRequest = (reference: string) =>
  handlePaymentsRequest(
    new Request('https://fn.example/payments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'verify', reference }) }),
    { rpc: pgRpc(pool), gateway, clientKey: async () => `race-${++visitor}`, allowedOrigins: [] },
  );

async function overlappingPairs(): Promise<number> {
  const [{ n }] = await q(`
    with live as (
      select therapist_id, tstzrange(starts_at, blocked_until) as r, 'hold-' || id as ref
      from booking_holds where status = 'active' and expires_at > now()
      union all
      select therapist_id, tstzrange(starts_at, blocked_until), 'appt-' || id
      from appointments where status in ('pending_payment', 'confirmed', 'completed')
    )
    select count(*)::int as n from live a join live b on a.therapist_id = b.therapist_id and a.ref < b.ref and a.r && b.r`);
  return n;
}

beforeAll(async () => {
  database = await startRealPostgres(N * 2 + 4);
  pool = database.pool;
  paystack = await startFakePaystack();
  gateway = new PaystackAdapter(FAKE_SECRET_KEY, { baseUrl: paystack.url });
  await q(`update business_settings set online_payment_enabled = true, payment_mode = 'full'`);
  swedish = (await q(`select id from services where slug = 'swedish'`))[0].id;
  A = (await q(`select id from therapists where sort_order = 1`))[0].id;
}, 180_000);

afterAll(async () => {
  await paystack?.close();
  await database?.stop();
});

describe('payment races (real PostgreSQL, separate connections)', () => {
  it(`${N} simultaneous success results for one payment create exactly one appointment`, async () => {
    const { hold, reference } = await started();
    const results = await Promise.allSettled(Array.from({ length: N }, () => recordSuccess(reference)));
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const outcomes = results.map((r) => (r as PromiseFulfilledResult<pg.QueryResult>).value.rows[0].r);
    expect(new Set(outcomes.map((o) => o.status))).toEqual(new Set(['confirmed']));
    expect(new Set(outcomes.map((o) => o.appointment.reference)).size).toBe(1);
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
    expect(await q(`select id from payments where hold_id = $1`, [hold.id])).toHaveLength(1);
  });

  it(`${N} simultaneous duplicate webhook deliveries are all acknowledged and book once`, async () => {
    const { hold, reference } = await started();
    paystack.pay(reference);
    const responses = await Promise.all(Array.from({ length: N }, () => webhookRequest(reference)));
    expect(responses.map((r) => r.status)).toEqual(Array(N).fill(200));
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
    expect(await q(`select id from payments where hold_id = $1`, [hold.id])).toHaveLength(1);
    const events = await q(`select processed_at from payment_events where event_id = $1`, [`charge.success:${paystack.transactions.get(reference)!.id}`]);
    expect(events).toHaveLength(1);
    expect(events[0].processed_at).not.toBeNull();
  });

  it('webhook and browser verify arriving together book once and agree on the result', async () => {
    const { hold, reference } = await started();
    paystack.pay(reference);
    const calls = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? webhookRequest(reference) : verifyRequest(reference)));
    const responses = await Promise.all(calls);
    expect(responses.map((r) => r.status)).toEqual(Array(N).fill(200));
    const verifyBodies = await Promise.all(responses.filter((_, i) => i % 2 === 1).map((r) => r.json()));
    const [appointment] = await q(`select reference from appointments where hold_id = $1`, [hold.id]);
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
    expect(new Set(verifyBodies.map((b) => `${b.status}:${b.appointment?.reference}`))).toEqual(new Set([`confirmed:${appointment.reference}`]));
  });

  it('two payments for the same hold succeeding together: one booking, the other flagged for refund', async () => {
    const first = await started();
    await q(`select record_payment_result('paystack', $1, 'failed')`, [first.reference]);
    const [{ r: second }] = await q(`select begin_hold_payment($1, 'paystack', true) as r`, [first.hold.hold_token]);

    const results = await Promise.all([recordSuccess(first.reference), recordSuccess(second.reference)]);
    const outcomes = results.map((r) => r.rows[0].r);
    expect(outcomes.map((o) => o.status).sort()).toEqual(['confirmed', 'refund_required']);
    expect(outcomes.find((o) => o.status === 'refund_required').reason).toBe('duplicate_payment');
    expect(await appointmentsFor(first.hold.id)).toHaveLength(1);
  });

  it('a late payment racing a new guest for the same slot: exactly one of them gets it, every round', async () => {
    const rounds = 12;
    let paidWon = 0;
    let guestWon = 0;
    for (let round = 0; round < rounds; round++) {
      const start = nextSlot();
      const { hold, reference } = await started(start);
      await expire(hold.id);

      const [payer, newcomer] = await Promise.allSettled([
        recordSuccess(reference),
        pool.query(`select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), A]),
      ]);

      expect(payer.status).toBe('fulfilled'); // the payment result is always recorded, never an error
      const outcome = (payer as PromiseFulfilledResult<pg.QueryResult>).value.rows[0].r;
      const booked = (await appointmentsFor(hold.id)).length;

      if (newcomer.status === 'fulfilled') {
        guestWon++;
        expect(outcome).toMatchObject({ status: 'refund_required', reason: 'slot_retaken' });
        expect(booked).toBe(0);
      } else {
        paidWon++;
        expect((newcomer as PromiseRejectedResult).reason.message).toBe('slot_unavailable'); // never a deadlock
        expect(outcome.status).toBe('confirmed');
        expect(booked).toBe(1);
      }
    }
    expect(paidWon + guestWon).toBe(rounds);
    expect(await overlappingPairs()).toBe(0);
  });

  it('many late payments and many new guests at once never double-book', async () => {
    const start = nextSlot();
    // Five guests each held this slot at some point and paid; all holds have lapsed.
    const payers = [];
    for (let i = 0; i < 5; i++) {
      const s = await started(start);
      await expire(s.hold.id);
      await q(`select run_booking_maintenance()`);
      payers.push(s);
    }
    const calls = [
      ...payers.map((p) => recordSuccess(p.reference)),
      ...Array.from({ length: 10 }, () => pool.query(`select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), A])),
      pool.query(`select run_booking_maintenance()`),
    ];
    const results = await Promise.allSettled(calls);

    const paymentErrors = results.slice(0, 5).filter((r) => r.status === 'rejected');
    expect(paymentErrors).toEqual([]);
    const outcomes = results.slice(0, 5).map((r) => (r as PromiseFulfilledResult<pg.QueryResult>).value.rows[0].r.status);
    const newHolds = results.slice(5, 15).filter((r) => r.status === 'fulfilled').length;
    const otherErrors = results.slice(5, 15).filter((r) => r.status === 'rejected' && r.reason.message !== 'slot_unavailable');
    expect(otherErrors).toEqual([]);

    const confirmed = outcomes.filter((s) => s === 'confirmed').length;
    expect(confirmed + newHolds).toBe(1); // the slot went to exactly one party
    expect(outcomes.filter((s) => s === 'refund_required').length).toBe(5 - confirmed);
    expect(await q(`select id from payments where needs_refund and hold_id = any($1::uuid[])`, [payers.map((p) => p.hold.id)])).toHaveLength(5 - confirmed);
    expect(await overlappingPairs()).toBe(0);
  });

  it('a rule change that is still in progress makes the payment wait, then is seen by it', async () => {
    const start = nextSlot();
    const { hold, reference } = await started(start);

    const admin = await pool.connect();
    let outcome: any;
    try {
      await admin.query('begin');
      await admin.query(`insert into therapist_time_off (therapist_id, starts_at, ends_at) values ($1, $2, $3)`, [
        A, start.toISOString(), new Date(start.getTime() + 3_600_000).toISOString(),
      ]);

      // The time off is not committed yet. The payment must neither book past it nor guess.
      let settled = false;
      const paying = recordSuccess(reference).then((r) => {
        settled = true;
        return r;
      });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(settled).toBe(false);
      expect(await appointmentsFor(hold.id)).toEqual([]);

      await admin.query('commit');
      outcome = (await paying).rows[0].r;
    } finally {
      await admin.query('rollback').catch(() => {});
      admin.release();
    }
    expect(outcome).toMatchObject({ status: 'refund_required', reason: 'schedule_changed' });
    expect(await appointmentsFor(hold.id)).toEqual([]);
    await q(`delete from therapist_time_off`);
  });

  it('a rule change rolled back does not affect the waiting payment', async () => {
    const start = nextSlot();
    const { hold, reference } = await started(start);
    const admin = await pool.connect();
    let outcome: any;
    try {
      await admin.query('begin');
      await admin.query(`update business_hours set is_closed = true`);
      const paying = recordSuccess(reference);
      await new Promise((resolve) => setTimeout(resolve, 800));
      await admin.query('rollback');
      outcome = (await paying).rows[0].r;
    } finally {
      admin.release();
    }
    expect(outcome.status).toBe('confirmed');
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
  });

  it('a payment that is still in progress makes the rule change wait until the appointment exists', async () => {
    const start = nextSlot();
    const { hold, reference } = await started(start);

    const payer = await pool.connect();
    let adminSettled = false;
    try {
      await payer.query('begin');
      const result = await payer.query(`select record_payment_result('paystack', $1, 'success', $2, 'NGN', now(), 'TX', 'card') as r`, [reference, PRICE]);
      expect(result.rows[0].r.status).toBe('confirmed'); // validated and inserted, not yet committed

      const adminChange = pool
        .query(`insert into therapist_time_off (therapist_id, starts_at, ends_at) values ($1, $2, $3)`, [A, start.toISOString(), new Date(start.getTime() + 3_600_000).toISOString()])
        .then(() => {
          adminSettled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(adminSettled).toBe(false);

      await payer.query('commit');
      await adminChange;
    } finally {
      await payer.query('rollback').catch(() => {});
      payer.release();
    }
    // The owner's change went through after the booking, which is visible to them.
    expect(adminSettled).toBe(true);
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
    await q(`delete from therapist_time_off`);
  });

  it('payments for different therapists do not wait for each other', async () => {
    const start = nextSlot();
    const therapists = (await q(`select id from therapists order by sort_order`)).map((r) => r.id);
    const payers = [];
    for (const therapist of therapists) {
      const [hold] = await q(`select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), therapist]);
      await q(`select attach_customer_to_hold($1, 'Test Guest', $2, '+2348000000000')`, [hold.hold_token, `race${++guest}@example.com`]);
      const [{ r }] = await q(`select begin_hold_payment($1, 'paystack', true) as r`, [hold.hold_token]);
      payers.push({ hold, reference: r.reference });
    }
    // One payer's transaction stays open (holding the shared lock and its own therapist lock)...
    const first = await pool.connect();
    try {
      await first.query('begin');
      await first.query(`select record_payment_result('paystack', $1, 'success', $2, 'NGN', now(), 'TX', 'card')`, [payers[0].reference, PRICE]);
      // ...and the others still complete.
      const others = await Promise.all(payers.slice(1).map((p) => recordSuccess(p.reference)));
      expect(others.map((r) => r.rows[0].r.status)).toEqual(['confirmed', 'confirmed', 'confirmed']);
      await first.query('commit');
    } finally {
      await first.query('rollback').catch(() => {});
      first.release();
    }
    for (const p of payers) expect(await appointmentsFor(p.hold.id)).toHaveLength(1);
  });

  it('the Phase 2 guarantee still holds with payments in play: one slot, one hold', async () => {
    const start = nextSlot();
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => pool.query(`select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), A])),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await overlappingPairs()).toBe(0);
  });
});
