import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRealPostgres, type RealPostgres } from '../support/real-postgres';
import { at, upcoming, FRI, MON, SAT, THU, TUE, WED } from './dates';

// Phase 5b on a real PostgreSQL server: staff actions racing guests, payments
// and each other, every party on its own connection at the same moment.

let database: RealPostgres;
let pool: pg.Pool;
let admin: string;
let owner: string;
let swedish: string;
let therapists: string[];
let guestCount = 0;

/** Start times far enough apart that 60-minute bookings with their buffer never touch (13:00-14:00 is a break). */
const SPACED = ['09:00', '10:30', '14:00', '15:30', '17:00', '18:30'];

interface Call {
  as: 'service_role' | 'authenticated';
  user?: string;
  sql: string;
  params: unknown[];
}

/** Runs every call at the same moment, each in its own transaction on its own connection. */
async function race(calls: Call[]) {
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
    return results.map((r) => (r.status === 'fulfilled' ? { ok: true as const, row: r.value } : { ok: false as const, error: (r.reason as Error).message, detail: (r.reason as any).detail as string | undefined }));
  } finally {
    clients.forEach((c) => c.release());
  }
}

const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const version = async (apptId: string) => (await q(`select updated_at::text as v from appointments where id = $1`, [apptId]))[0].v as string;

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

const phoneBooking = (start: Date, therapist: string): Call => ({
  as: 'authenticated', user: admin,
  sql: `select * from staff_create_booking(p_source => 'phone', p_settlement => 'pay_at_venue', p_service_id => $1,
          p_starts_at => $2, p_reason => 'Booked by phone', p_therapist_id => $3,
          p_customer_name => 'Phone Guest', p_customer_phone => '+2348030000001')`,
  params: [swedish, start.toISOString(), therapist],
});
const guestHold = (start: Date, therapist: string): Call => ({
  as: 'service_role', sql: `select * from request_booking_hold($1, $2, $3)`, params: [swedish, start.toISOString(), therapist],
});

/** A guest who has reserved a time and started paying (demo provider). */
async function guestMidPayment(start: Date, therapist: string) {
  const n = ++guestCount;
  const [hold] = await q(`select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), therapist]);
  await q(`select attach_customer_to_hold($1, $2, $3, '+2348030000000')`, [hold.hold_token, `Guest ${n}`, `guest${n}@example.com`]);
  const [{ p }] = await q(`select begin_hold_payment($1, 'mock', true) as p`, [hold.hold_token]);
  return { hold, reference: p.reference as string, amount: Number(p.amount_minor) };
}
const paymentSucceeds = (reference: string, amount: number): Call => ({
  as: 'service_role', sql: `select record_payment_result('mock', $1, 'success', $2, 'NGN') as r`, params: [reference, amount],
});
/** A guest who has paid: their appointment exists. */
async function paidGuest(start: Date, therapist: string) {
  const g = await guestMidPayment(start, therapist);
  await q(`select record_payment_result('mock', $1, 'success', $2, 'NGN')`, [g.reference, g.amount]);
  const [appt] = await q(`select a.* from appointments a join payments p on p.appointment_id = a.id where p.provider_reference = $1`, [g.reference]);
  return { ...g, appt };
}

beforeAll(async () => {
  database = await startRealPostgres(8);
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

describe('phone bookings racing online bookings', () => {
  it('a phone booking and a guest reserving the same time: exactly one gets it, ten times over', async () => {
    // Each booking blocks 75 minutes (treatment plus turnover), so rounds are 90 minutes apart.
    const slots = SPACED.flatMap((time) => [at(upcoming(MON, 1), time), at(upcoming(MON, 3), time)]).slice(0, 10);
    for (const start of slots) {
      const [phone, guest] = await race([phoneBooking(start, therapists[0]), guestHold(start, therapists[0])]);
      expect([phone.ok, guest.ok].filter(Boolean), JSON.stringify([phone, guest])).toHaveLength(1);
      if (!phone.ok) expect(phone.error).toBe('slot_unavailable');
    }
    expect(await overlappingPairs()).toBe(0);
  });

  it('a phone booking against a late payment for a lapsed reservation: one booking, the other payment is flagged for refund', async () => {
    const start = at(upcoming(TUE, 1), '10:00');
    const g = await guestMidPayment(start, therapists[1]);
    await q(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [g.hold.id]);
    const [phone, pay] = await race([phoneBooking(start, therapists[1]), paymentSucceeds(g.reference, g.amount)]);
    expect(pay.ok).toBe(true);
    const booked = await q(`select source from appointments where therapist_id = $1 and starts_at = $2 and status = 'confirmed'`, [therapists[1], start.toISOString()]);
    expect(booked).toHaveLength(1);
    const [payment] = await q(`select * from payments where provider_reference = $1`, [g.reference]);
    if (phone.ok) {
      expect(booked[0].source).toBe('phone');
      expect(payment).toMatchObject({ status: 'succeeded', appointment_id: null, needs_refund: true, needs_refund_reason: 'slot_retaken' });
    } else {
      expect(booked[0].source).toBe('online');
      expect(payment.needs_refund).toBe(false);
    }
    expect(await overlappingPairs()).toBe(0);
  });
});

describe('rescheduling racing guests and payments', () => {
  it('moving a booking onto a time a guest is reserving: exactly one gets it', async () => {
    const created: any[] = [];
    for (const time of SPACED.slice(0, 5)) {
      const [r] = await race([phoneBooking(at(upcoming(WED, 1), time), therapists[2])]);
      expect(r.ok).toBe(true);
      created.push((r as any).row);
    }
    for (const [i, appt] of created.entries()) {
      const target = at(upcoming(THU, 1), SPACED[i]);
      const [move, hold] = await race([
        { as: 'authenticated', user: admin, sql: `select * from staff_reschedule_appointment($1, $2, 'guest asked', $3, $4)`,
          params: [appt.id, target.toISOString(), await version(appt.id), therapists[3]] },
        guestHold(target, therapists[3]),
      ]);
      expect([move.ok, hold.ok].filter(Boolean)).toHaveLength(1);
      if (!move.ok) expect(move.error).toBe('slot_unavailable');
    }
    expect(await overlappingPairs()).toBe(0);
  });

  it('moving a booking onto a lapsed reservation whose payment arrives at that moment: one booking only', async () => {
    const target = at(upcoming(FRI, 1), '10:00');
    const g = await guestMidPayment(target, therapists[0]);
    await q(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [g.hold.id]);
    const [r] = await race([phoneBooking(at(upcoming(FRI, 1), '15:00'), therapists[0])]);
    const appt = (r as any).row;
    const [move, pay] = await race([
      { as: 'authenticated', user: admin, sql: `select * from staff_reschedule_appointment($1, $2, 'guest asked', $3)`,
        params: [appt.id, target.toISOString(), await version(appt.id)] },
      paymentSucceeds(g.reference, g.amount),
    ]);
    expect(pay.ok).toBe(true);
    const atTarget = await q(`select id from appointments where therapist_id = $1 and starts_at = $2 and status = 'confirmed'`, [therapists[0], target.toISOString()]);
    expect(atTarget).toHaveLength(1);
    const [payment] = await q(`select * from payments where provider_reference = $1`, [g.reference]);
    expect(payment.needs_refund).toBe(move.ok); // the payment lost exactly when the move won
    expect(await overlappingPairs()).toBe(0);
  });

  it('a guest paying for a live reservation always keeps it; the move is refused', async () => {
    const target = at(upcoming(SAT, 1), '10:00');
    const g = await guestMidPayment(target, therapists[1]);
    const [r] = await race([phoneBooking(at(upcoming(SAT, 1), '15:00'), therapists[1])]);
    const appt = (r as any).row;
    const [move, pay] = await race([
      { as: 'authenticated', user: owner, sql: `select * from staff_reschedule_appointment($1, $2, 'guest asked', $3, null, true)`,
        params: [appt.id, target.toISOString(), await version(appt.id)] },
      paymentSucceeds(g.reference, g.amount),
    ]);
    expect(move).toMatchObject({ ok: false, error: 'slot_unavailable' });
    expect(pay.ok).toBe(true);
    const [payment] = await q(`select needs_refund, appointment_id from payments where provider_reference = $1`, [g.reference]);
    expect(payment.needs_refund).toBe(false);
    expect(payment.appointment_id).not.toBeNull();
  });
});

describe('two staff members on the same appointment', () => {
  it('two edits from the same version: one wins, the other is told it is stale', async () => {
    const [r] = await race([phoneBooking(at(upcoming(MON, 2), '10:00'), therapists[2])]);
    const appt = (r as any).row;
    const v = await version(appt.id);
    const [a, b] = await race([
      { as: 'authenticated', user: admin, sql: `select * from staff_reschedule_appointment($1, $2, 'admin moves it', $3)`,
        params: [appt.id, at(upcoming(MON, 2), '15:00').toISOString(), v] },
      { as: 'authenticated', user: owner, sql: `select staff_cancel_appointment($1, 'owner cancels it', $2)`, params: [appt.id, v] },
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ error: 'stale_record' });
    const [after] = await q(`select status, starts_at from appointments where id = $1`, [appt.id]);
    if (a.ok) expect(after.status).toBe('confirmed');
    else expect(after.status).toBe('cancelled');
    const entries = await q(`select action from audit_log where entity_id = $1 and action in ('appointment.rescheduled', 'appointment.cancelled')`, [appt.id]);
    expect(entries).toHaveLength(1);
  });

  it('two bookings moved onto the same time at once: one moves, the other is refused', async () => {
    const [r1] = await race([phoneBooking(at(upcoming(TUE, 2), '10:00'), therapists[3])]);
    const [r2] = await race([phoneBooking(at(upcoming(TUE, 2), '11:00'), therapists[0])]);
    const target = at(upcoming(TUE, 2), '16:00');
    const [a, b] = await race([
      { as: 'authenticated', user: admin, sql: `select * from staff_reschedule_appointment($1, $2, 'move', $3, $4)`,
        params: [(r1 as any).row.id, target.toISOString(), await version((r1 as any).row.id), therapists[1]] },
      { as: 'authenticated', user: owner, sql: `select * from staff_reschedule_appointment($1, $2, 'move', $3, $4)`,
        params: [(r2 as any).row.id, target.toISOString(), await version((r2 as any).row.id), therapists[1]] },
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ error: 'slot_unavailable' });
    expect(await overlappingPairs()).toBe(0);
  });
});

describe('cancellation racing payments', () => {
  it('cancelling a paid booking while its payment result is delivered again: cancelled and flagged, never refunded', async () => {
    const g = await paidGuest(at(upcoming(WED, 2), '10:00'), therapists[2]);
    const [cancel, replay] = await race([
      { as: 'authenticated', user: admin, sql: `select staff_cancel_appointment($1, 'Guest called to cancel', $2) as r`, params: [g.appt.id, await version(g.appt.id)] },
      paymentSucceeds(g.reference, g.amount),
    ]);
    expect(cancel.ok).toBe(true);
    expect(replay.ok).toBe(true);
    const [payment] = await q(`select * from payments where provider_reference = $1`, [g.reference]);
    expect(payment).toMatchObject({ status: 'succeeded', needs_refund: true, needs_refund_reason: 'appointment_cancelled', refund_status: 'none' });
    expect(Number(payment.refunded_minor)).toBe(0);
    const [appt] = await q(`select status from appointments where id = $1`, [g.appt.id]);
    expect(appt.status).toBe('cancelled');
  });

  it('cancelling while the provider reports a full refund: consistent either way', async () => {
    const g = await paidGuest(at(upcoming(THU, 2), '10:00'), therapists[3]);
    const [cancel, refund] = await race([
      { as: 'authenticated', user: owner, sql: `select staff_cancel_appointment($1, 'Guest called to cancel', $2) as r`, params: [g.appt.id, await version(g.appt.id)] },
      { as: 'service_role', sql: `select record_refund_event('mock', $1, 'processed', 'RF-1', $2) as r`, params: [g.reference, g.amount] },
    ]);
    expect(cancel.ok && refund.ok).toBe(true);
    const [payment] = await q(`select * from payments where provider_reference = $1`, [g.reference]);
    expect(payment).toMatchObject({ status: 'refunded', needs_refund: false, refund_status: 'processed' });
    expect(Number(payment.refunded_minor)).toBe(g.amount);
  });

  it('cancelling while a guest asks for the same time: never an overlap', async () => {
    for (const time of SPACED.slice(0, 3)) {
      const start = at(upcoming(FRI, 2), time);
      const [r] = await race([phoneBooking(start, therapists[0])]);
      const appt = (r as any).row;
      const [cancel, hold] = await race([
        { as: 'authenticated', user: admin, sql: `select staff_cancel_appointment($1, 'Guest cancelled', $2) as r`, params: [appt.id, await version(appt.id)] },
        guestHold(start, therapists[0]),
      ]);
      expect(cancel.ok).toBe(true);
      if (!hold.ok) expect(hold.error).toBe('slot_unavailable');
      // Once the cancellation has gone through, the time is free.
      const [again] = await race([guestHold(start, therapists[0])]);
      expect(again.ok).toBe(!hold.ok);
    }
    expect(await overlappingPairs()).toBe(0);
  });
});
