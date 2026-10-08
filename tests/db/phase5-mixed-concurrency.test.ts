import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRealPostgres, type RealPostgres } from '../support/real-postgres';
import { at, upcoming } from './dates';

// Phase 5e: everything at once, on a real PostgreSQL server. Each round fires,
// at the same moment on separate connections: guests reserving a time, a
// phone booking and a reschedule onto that same time; time off being added
// while a guest's payment completes; a cancellation while a guest asks for the
// freed time; and an owner recording a refund. Afterwards, the system-wide
// invariants must hold.

const ROUNDS = 6;
let database: RealPostgres;
let pool: pg.Pool;
let owner: string;
let admin: string;
let swedish: string;
let therapists: string[];
let guests = 0;

interface Call { as: 'service_role' | 'authenticated'; user?: string; sql: string; params: unknown[] }
type Result = { ok: true; row: any } | { ok: false; error: string; detail?: string };

async function race(calls: Call[]): Promise<Result[]> {
  const clients = await Promise.all(calls.map(() => pool.connect()));
  try {
    await Promise.all(clients.map(async (c, i) => {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [calls[i].user ?? '']);
      await c.query(`set local role ${calls[i].as}`);
    }));
    const results = await Promise.allSettled(clients.map(async (c, i) => {
      try {
        const { rows } = await c.query(calls[i].sql, calls[i].params);
        await c.query('commit');
        return rows[0];
      } catch (err) {
        await c.query('rollback');
        throw err;
      }
    }));
    return results.map((r) => (r.status === 'fulfilled'
      ? { ok: true as const, row: r.value }
      : { ok: false as const, error: (r.reason as Error).message, detail: (r.reason as any).detail }));
  } finally {
    clients.forEach((c) => c.release());
  }
}
const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const version = async (table: string, id: string) => (await q(`select updated_at::text as v from ${table} where id = $1`, [id]))[0].v as string;

const asAdmin = (sql: string, params: unknown[]): Call => ({ as: 'authenticated', user: admin, sql, params });
const phoneBooking = (start: Date, therapist: string): Call => asAdmin(
  `select * from staff_create_booking(p_source => 'phone', p_settlement => 'pay_at_venue', p_service_id => $1, p_starts_at => $2,
     p_reason => 'Booked by phone', p_therapist_id => $3, p_customer_name => 'Mixed Guest', p_customer_phone => '+2348036660000')`,
  [swedish, start.toISOString(), therapist]);
const guestHold = (start: Date, therapist: string): Call => ({
  as: 'service_role', sql: `select * from request_booking_hold($1, $2, $3)`, params: [swedish, start.toISOString(), therapist],
});

async function midPayment(start: Date, therapist: string) {
  const n = ++guests;
  const [hold] = await q(`select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), therapist]);
  await q(`select attach_customer_to_hold($1, $2, $3, '+2348036660001')`, [hold.hold_token, `Mixed Payer ${n}`, `mixed${n}@example.com`]);
  const [{ p }] = await q(`select begin_hold_payment($1, 'mock', true) as p`, [hold.hold_token]);
  return { hold, reference: p.reference as string, amount: Number(p.amount_minor) };
}
async function paid(start: Date, therapist: string) {
  const g = await midPayment(start, therapist);
  await q(`select record_payment_result('mock', $1, 'success', $2, 'NGN')`, [g.reference, g.amount]);
  return (await q(`select *, updated_at::text as v from payments where provider_reference = $1`, [g.reference]))[0];
}
async function made(call: Call) {
  const [r] = await race([call]);
  if (!r.ok) throw new Error(`setup failed: ${(r as any).error} ${(r as any).detail ?? ''}`);
  return r.row;
}

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
  database = await startRealPostgres(14);
  pool = database.pool;
  const staff = async (email: string, role: string) => {
    const [{ id }] = await q(`insert into auth.users (email) values ($1) returning id`, [email]);
    await q(`update profiles set role = $2, is_active = true where id = $1`, [id, role]);
    return id as string;
  };
  owner = await staff('owner@example.com', 'owner');
  admin = await staff('admin@example.com', 'admin');
  swedish = (await q(`select id from services where slug = 'swedish'`))[0].id;
  therapists = (await q(`select id from therapists order by sort_order`)).map((r) => r.id);
}, 180_000);

afterAll(async () => {
  await database?.stop();
});

describe(`guests, payments, staff and schedule changes all at once (${ROUNDS} rounds)`, () => {
  it('every round resolves consistently, and the system-wide invariants hold', async () => {
    const outcomes = { contestedWinners: [] as string[], paymentBooked: 0, paymentFlagged: 0, freedRetaken: 0 };
    for (let round = 0; round < ROUNDS; round++) {
      const day = upcoming(1 + (round % 6), 1 + Math.floor(round / 6)); // Monday to Saturday
      const [t1, t2] = [therapists[round % 2 ? 2 : 0], therapists[round % 2 ? 3 : 1]];
      const contested = at(day, '14:00');

      const toMove = await made(phoneBooking(at(day, '09:00'), t1));
      const toCancel = await made(phoneBooking(at(day, '09:00'), t2));
      const toRefund = await paid(at(day, '17:00'), t2);
      const paying = await midPayment(at(day, '17:00'), t1);

      const results = await race([
        guestHold(contested, t1),
        guestHold(contested, t1),
        phoneBooking(contested, t1),
        asAdmin(`select * from staff_reschedule_appointment($1, $2, 'Guest asked', $3)`, [toMove.id, contested.toISOString(), await version('appointments', toMove.id)]),
        asAdmin(`select staff_add_time_off($1, $2, $3, 'Leave', 'Agreed leave', true) as r`, [t1, at(day, '16:30').toISOString(), at(day, '18:30').toISOString()]),
        { as: 'service_role', sql: `select record_payment_result('mock', $1, 'success', $2, 'NGN') as r`, params: [paying.reference, paying.amount] },
        asAdmin(`select staff_cancel_appointment($1, 'Guest cancelled', $2) as r`, [toCancel.id, await version('appointments', toCancel.id)]),
        guestHold(at(day, '09:00'), t2),
        { as: 'authenticated', user: owner, sql: `select owner_record_refund($1, $2, 'cash', 'Refund agreed', $3) as r`, params: [toRefund.id, toRefund.paid_minor, toRefund.v] },
      ]);
      const [holdA, holdB, phone, move, timeOff, payment, cancel, retake, refund] = results;

      // Exactly one of the four contenders got the contested time.
      const winners = [holdA, holdB, phone, move].filter((r) => r.ok);
      expect(winners, `round ${round}: ${JSON.stringify(results.map((r) => (r.ok ? 'ok' : (r as any).error)))}`).toHaveLength(1);
      outcomes.contestedWinners.push(['hold', 'hold', 'phone', 'move'][[holdA, holdB, phone, move].indexOf(winners[0])]);
      for (const loser of [holdA, holdB, phone, move].filter((r) => !r.ok)) expect(loser).toMatchObject({ error: 'slot_unavailable' });

      // Time off always lands; the payment either became a booking (now listed as a conflict) or was flagged.
      expect(timeOff.ok && payment.ok && cancel.ok && refund.ok).toBe(true);
      const [p] = await q(`select * from payments where provider_reference = $1`, [paying.reference]);
      if (p.appointment_id) {
        outcomes.paymentBooked++;
        const [c] = await q(`select array_agg(reason) as r from private.appointment_conflicts() where appointment_id = $1`, [p.appointment_id]);
        expect(c.r).toEqual(['time_off']);
      } else {
        outcomes.paymentFlagged++;
        expect(p).toMatchObject({ needs_refund: true, needs_refund_reason: 'schedule_changed', needs_refund_detail: 'time_off' });
      }

      // The cancelled time is either retaken by the guest or still free; never double-booked.
      if (retake.ok) outcomes.freedRetaken++;
      else expect(retake).toMatchObject({ error: 'slot_unavailable' });

      expect(await overlappingPairs(), `round ${round}`).toBe(0);
    }

    // System-wide invariants.
    expect(await overlappingPairs()).toBe(0);
    // A booking made from an online payment always has a received payment.
    expect(await q(`select a.id from appointments a where a.source = 'online' and not exists (
      select 1 from payments p where p.appointment_id = a.id and p.status in ('succeeded', 'partially_refunded', 'refunded'))`)).toEqual([]);
    // Money received is always either attached to a booking or flagged for refund.
    expect(await q(`select id from payments where status in ('succeeded', 'partially_refunded') and appointment_id is null and not needs_refund`)).toEqual([]);
    // No failed or abandoned payment ever produced a booking.
    expect(await q(`select id from payments where status in ('failed', 'abandoned', 'initialized', 'pending') and appointment_id is not null`)).toEqual([]);
    // Refunds never exceed what was received.
    expect(await q(`select id from payments where refunded_minor > coalesce(paid_minor, 0)`)).toEqual([]);
    // Phone bookings never touch the payment ledger.
    expect(await q(`select p.id from payments p join appointments a on a.id = p.appointment_id where a.source <> 'online'`)).toEqual([]);
    // Only staff cancellations cancelled anything; schedule changes cancelled and moved nothing.
    const cancelled = await q(`select id from appointments where status = 'cancelled'`);
    const cancelActions = await q(`select distinct entity_id from audit_log where action = 'appointment.cancelled'`);
    expect(cancelled.map((r) => r.id).sort()).toEqual(cancelActions.map((r) => r.entity_id).sort());
    expect(await q(`select distinct action from audit_log where entity_type = 'appointments' and actor_kind = 'staff'
      and action not in ('appointment.created_by_staff', 'appointment.rescheduled', 'appointment.cancelled')`)).toEqual([]);
    // Every round exercised both outcomes somewhere, or at least resolved each race.
    expect(outcomes.contestedWinners).toHaveLength(ROUNDS);
    expect(outcomes.paymentBooked + outcomes.paymentFlagged).toBe(ROUNDS);
  });
});
