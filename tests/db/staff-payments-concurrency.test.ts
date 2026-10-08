import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRealPostgres, type RealPostgres } from '../support/real-postgres';
import { at, upcoming, FRI, MON, THU, TUE, WED } from './dates';

// Phase 5d on a real PostgreSQL server: refund records racing each other,
// provider refund events, cancellations and payment replays; staff account
// changes racing each other and in-flight staff actions.

let database: RealPostgres;
let pool: pg.Pool;
let owner: string;
let owner2: string;
let swedish: string;
let therapists: string[];
let guests = 0;

interface Call { as: 'service_role' | 'authenticated'; user?: string; sql: string; params: unknown[] }
type Result = { ok: true; row: any } | { ok: false; error: string };

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
    return results.map((r) => (r.status === 'fulfilled' ? { ok: true as const, row: r.value } : { ok: false as const, error: (r.reason as Error).message }));
  } finally {
    clients.forEach((c) => c.release());
  }
}
const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const payment = async (ref: string) => (await q(`select *, updated_at::text as v from payments where provider_reference = $1`, [ref]))[0];

/** A guest who has paid (demo provider): their booking exists. */
async function paidGuest(start: Date, therapist: string) {
  const n = ++guests;
  const [hold] = await q(`select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), therapist]);
  await q(`select attach_customer_to_hold($1, $2, $3, '+2348038880000')`, [hold.hold_token, `Guest ${n}`, `refund${n}@example.com`]);
  const [{ p }] = await q(`select begin_hold_payment($1, 'mock', true) as p`, [hold.hold_token]);
  await q(`select record_payment_result('mock', $1, 'success', $2, 'NGN')`, [p.reference, p.amount_minor]);
  return payment(p.reference);
}
const recordRefund = (user: string, p: any, amount: number, method = 'cash'): Call => ({
  as: 'authenticated', user,
  sql: `select owner_record_refund($1, $2, $3, 'Refund agreed with the guest', $4) as r`,
  params: [p.id, amount, method, p.v],
});
const profileVersion = async (id: string) => (await q(`select updated_at::text as v from profiles where id = $1`, [id]))[0].v as string;

beforeAll(async () => {
  database = await startRealPostgres(8);
  pool = database.pool;
  const staff = async (email: string, role: string) => {
    const [{ id }] = await q(`insert into auth.users (email) values ($1) returning id`, [email]);
    await q(`update profiles set role = $2, is_active = true where id = $1`, [id, role]);
    return id as string;
  };
  owner = await staff('owner@example.com', 'owner');
  owner2 = await staff('owner2@example.com', 'owner');
  swedish = (await q(`select id from services where slug = 'swedish'`))[0].id;
  therapists = (await q(`select id from therapists order by sort_order`)).map((r) => r.id);
}, 180_000);

afterAll(async () => {
  await database?.stop();
});

describe('refund records racing', () => {
  it('two owners recording a full cash refund from the same screen: one is recorded, the other is told it is stale', async () => {
    const p = await paidGuest(at(upcoming(MON, 1), '10:30'), therapists[0]);
    const [a, b] = await race([recordRefund(owner, p, Number(p.paid_minor)), recordRefund(owner2, p, Number(p.paid_minor))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ error: 'stale_record' });
    const after = await payment(p.provider_reference);
    expect(Number(after.refunded_minor)).toBe(Number(p.paid_minor));
    expect((await q(`select count(*)::int as n from refund_records where payment_id = $1`, [p.id]))[0].n).toBe(1);
  });

  it('a cash refund against the provider reporting a refund: never more than was paid', async () => {
    const p = await paidGuest(at(upcoming(TUE, 1), '10:30'), therapists[1]);
    const [cash, provider] = await race([
      recordRefund(owner, p, Number(p.paid_minor)),
      { as: 'service_role', sql: `select record_refund_event('mock', $1, 'processed', 'RF-RACE', $2) as r`, params: [p.provider_reference, p.paid_minor] },
    ]);
    expect(provider.ok).toBe(true);
    if (!cash.ok) expect(cash).toMatchObject({ error: expect.stringMatching(/^(stale_record|not_refundable)$/) });
    const after = await payment(p.provider_reference);
    expect(after.status).toBe('refunded');
    expect(Number(after.refunded_minor)).toBe(Number(p.paid_minor));
    expect(Number(after.refundable_minor)).toBe(0);
  });

  it('a refund against a cancellation of the same booking: consistent either way, never automatic', async () => {
    const p = await paidGuest(at(upcoming(WED, 1), '10:30'), therapists[2]);
    const [{ v: apptVersion }] = await q(`select updated_at::text as v from appointments where id = $1`, [p.appointment_id]);
    const [refund, cancel] = await race([
      recordRefund(owner, p, Number(p.paid_minor), 'bank_transfer'),
      { as: 'authenticated', user: owner2, sql: `select staff_cancel_appointment($1, 'Guest cancelled', $2) as r`, params: [p.appointment_id, apptVersion] },
    ]);
    expect(cancel.ok).toBe(true);
    const after = await payment(p.provider_reference);
    const [appt] = await q(`select status from appointments where id = $1`, [p.appointment_id]);
    expect(appt.status).toBe('cancelled');
    if (refund.ok) {
      expect(after).toMatchObject({ status: 'refunded', needs_refund: false });
    } else {
      // The cancellation flagged the payment first; the refund was entered from an older screen.
      expect(refund).toMatchObject({ error: 'stale_record' });
      expect(after).toMatchObject({ status: 'succeeded', needs_refund: true, needs_refund_reason: 'appointment_cancelled' });
      expect(Number(after.refunded_minor)).toBe(0);
    }
  });

  it('a refund against a repeated payment result: the replay changes nothing, the refund stands', async () => {
    const p = await paidGuest(at(upcoming(THU, 1), '10:30'), therapists[3]);
    const [refund, replay] = await race([
      recordRefund(owner, p, Number(p.paid_minor)),
      { as: 'service_role', sql: `select record_payment_result('mock', $1, 'success', $2, 'NGN') as r`, params: [p.provider_reference, p.amount_minor] },
    ]);
    expect(refund.ok && replay.ok).toBe(true);
    const after = await payment(p.provider_reference);
    expect(after).toMatchObject({ status: 'refunded', appointment_id: p.appointment_id });
    expect((await q(`select count(*)::int as n from appointments where hold_id = $1`, [p.hold_id]))[0].n).toBe(1);
  });
});

describe('staff accounts racing', () => {
  it('two owners changing the same account at once: one wins, the other is told it is stale', async () => {
    const [{ id }] = await q(`insert into auth.users (email) values ('target@example.com') returning id`);
    const v = await profileVersion(id);
    const [a, b] = await race([
      { as: 'authenticated', user: owner, sql: `select owner_set_staff_role($1, 'admin', 'Front desk', $2)`, params: [id, v] },
      { as: 'authenticated', user: owner2, sql: `select owner_set_staff_active($1, true, 'Starting', $2)`, params: [id, v] },
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ error: 'stale_record' });
  });

  it('an admin deactivated while cancelling a booking: the cancel either completed first or is refused; afterwards they can do nothing', async () => {
    const [{ id: admin }] = await q(`insert into auth.users (email) values ('admin.race@example.com') returning id`);
    await q(`update profiles set role = 'admin', is_active = true where id = $1`, [admin]);
    const [made] = await race([{ as: 'authenticated', user: admin, sql: `select * from staff_create_booking(p_source => 'phone', p_settlement => 'pay_at_venue',
        p_service_id => $1, p_starts_at => $2, p_reason => 'Booked by phone', p_therapist_id => $3,
        p_customer_name => 'Race Guest', p_customer_phone => '+2348038880001')`, params: [swedish, at(upcoming(FRI, 1), '10:30').toISOString(), therapists[0]] }]);
    const apptId = (made as any).row.id;
    const [{ v: apptVersion }] = await q(`select updated_at::text as v from appointments where id = $1`, [apptId]);
    const [deactivate, cancel] = await race([
      { as: 'authenticated', user: owner, sql: `select owner_set_staff_active($1, false, 'Left', $2)`, params: [admin, await profileVersion(admin)] },
      { as: 'authenticated', user: admin, sql: `select staff_cancel_appointment($1, 'Guest cancelled', $2)`, params: [apptId, apptVersion] },
    ]);
    expect(deactivate.ok).toBe(true);
    const [appt] = await q(`select status from appointments where id = $1`, [apptId]);
    if (cancel.ok) expect(appt.status).toBe('cancelled');
    else {
      expect(cancel).toMatchObject({ error: 'not_authorized' });
      expect(appt.status).toBe('confirmed');
    }
    const [after] = await race([{ as: 'authenticated', user: admin, sql: `select * from staff_payments('all')`, params: [] }]);
    expect(after).toMatchObject({ ok: false, error: 'not_authorized' });
  });

  it('two owners deactivating each other: one active owner always remains', async () => {
    const [a, b] = await race([
      { as: 'authenticated', user: owner, sql: `select owner_set_staff_active($1, false, 'Handing over', $2)`, params: [owner2, await profileVersion(owner2)] },
      { as: 'authenticated', user: owner2, sql: `select owner_set_staff_active($1, false, 'Handing over', $2)`, params: [owner, await profileVersion(owner)] },
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect((await q(`select count(*)::int as n from profiles where role = 'owner' and is_active`))[0].n).toBe(1);
  });
});

describe('after every race', () => {
  it('no payment was refunded beyond what was paid, and refund records are intact', async () => {
    expect(await q(`select id from payments where refunded_minor > coalesce(paid_minor, amount_minor)`)).toEqual([]);
    await expect(pool.query(`update refund_records set amount_minor = 1`)).rejects.toThrow(/refund_records_are_append_only/);
    await expect(pool.query(`delete from audit_log`)).rejects.toThrow(/audit_log_is_append_only/);
  });
});
