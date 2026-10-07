import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRealPostgres, type RealPostgres } from '../support/real-postgres';
import { at, upcoming, FRI, MON, SAT, THU, TUE, WED } from './dates';

// Phase 5c on a real PostgreSQL server: schedule and catalogue changes racing
// guests, payments, staff bookings and reschedules, each on its own
// connection. Whatever the order, existing bookings stay intact (listed as
// conflicts when the change no longer allows them), and the payment re-check
// refuses anything the change ruled out first.

let database: RealPostgres;
let pool: pg.Pool;
let admin: string;
let owner: string;
let swedish: string;
let deepTissue: string;
let therapists: string[];
let guestCount = 0;

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
const one = async (call: Call) => (await race([call]))[0];
const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

const asAdmin = (sql: string, params: unknown[]): Call => ({ as: 'authenticated', user: admin, sql, params });
const appointment = async (id: string) => (await q(`select * from appointments where id = $1`, [id]))[0];
const conflictsOf = async (id: string) =>
  (await q(`select coalesce(array_agg(reason order by reason), '{}') as r from private.appointment_conflicts() where appointment_id = $1`, [id]))[0].r as string[];
const version = async (id: string) => (await q(`select updated_at::text as v from appointments where id = $1`, [id]))[0].v as string;

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

const phoneBooking = (start: Date, therapist: string, opts: { service?: string; zone?: string } = {}): Call => asAdmin(
  `select * from staff_create_booking(p_source => 'phone', p_settlement => 'pay_at_venue', p_service_id => $1, p_starts_at => $2,
     p_reason => 'Booked by phone', p_therapist_id => $3, p_location_type => $4, p_dispatch_zone_id => $5, p_service_address => $6,
     p_customer_name => 'Race Guest', p_customer_phone => '+2348037770000')`,
  [opts.service ?? swedish, start.toISOString(), therapist, opts.zone ? 'mobile' : 'sanctuary', opts.zone ?? null, opts.zone ? '9 Ozumba Mbadiwe' : null],
);
const guestHold = (start: Date, therapist: string): Call => ({
  as: 'service_role', sql: `select * from request_booking_hold($1, $2, $3)`, params: [swedish, start.toISOString(), therapist],
});
const paymentSucceeds = (reference: string, amount: number): Call => ({
  as: 'service_role', sql: `select record_payment_result('mock', $1, 'success', $2, 'NGN') as r`, params: [reference, amount],
});
const timeOff = (therapist: string, from: Date, to: Date): Call =>
  asAdmin(`select staff_add_time_off($1, $2, $3, 'Leave', 'Agreed leave', true) as r`, [therapist, from.toISOString(), to.toISOString()]);

/** A guest who has reserved a time and started paying (demo provider). */
async function guestMidPayment(start: Date, therapist: string) {
  const n = ++guestCount;
  const [hold] = await q(`select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), therapist]);
  return { hold, ...(await pay(hold, n)) };
}
async function pay(hold: any, n = ++guestCount) {
  await q(`select attach_customer_to_hold($1, $2, $3, '+2348037770001')`, [hold.hold_token, `Guest ${n}`, `race${n}@example.com`]);
  const [{ p }] = await q(`select begin_hold_payment($1, 'mock', true) as p`, [hold.hold_token]);
  return { reference: p.reference as string, amount: Number(p.amount_minor) };
}
const paymentRow = async (reference: string) => (await q(`select * from payments where provider_reference = $1`, [reference]))[0];

async function serviceFields(id: string, changes: Record<string, unknown>) {
  const [s] = await q(`select *, updated_at::text as v from services where id = $1`, [id]);
  return { v: s.v as string, fields: JSON.stringify({
    slug: s.slug, name: s.name, category: s.category, description: s.description, benefits: s.benefits,
    duration_minutes: s.duration_minutes, buffer_minutes: s.buffer_minutes, price_minor: Number(s.price_minor),
    compare_at_price_minor: s.compare_at_price_minor === null ? null : Number(s.compare_at_price_minor),
    is_popular: s.is_popular, is_active: s.is_active, sort_order: s.sort_order, ...changes,
  }) };
}
const saveService = async (id: string, changes: Record<string, unknown>): Promise<Call> => {
  const { v, fields } = await serviceFields(id, changes);
  return asAdmin(`select staff_save_service($1, $2, $3, 'Catalogue change', true) as r`, [id, v, fields]);
};
const saveTherapist = async (id: string, active: boolean): Promise<Call> => {
  const [t] = await q(`select *, updated_at::text as v from therapists where id = $1`, [id]);
  return asAdmin(`select staff_save_therapist($1, $2, $3, 'Availability change', true) as r`, [id, t.v,
    JSON.stringify({ display_name: t.display_name, title: t.title, specialty: t.specialty, bio: t.bio, is_active: active, sort_order: t.sort_order })]);
};
const saveZone = async (id: string, active: boolean): Promise<Call> => {
  const [z] = await q(`select *, updated_at::text as v from dispatch_zones where id = $1`, [id]);
  return asAdmin(`select staff_save_zone($1, $2, $3, 'Area change', true) as r`, [id, z.v,
    JSON.stringify({ key: z.key, name: z.name, fee_minor: Number(z.fee_minor), is_active: active, sort_order: z.sort_order })]);
};
const WEEK = (days: number[]) => days.map((d) => ({ day_of_week: d, start_time: '09:00', end_time: '20:00' }));
const BREAKS = [1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_time: '13:00', end_time: '14:00' }));
const setWeek = async (therapist: string, days: number[]): Promise<Call> => {
  const [{ v }] = await q(`select private.therapist_week_version($1) as v`, [therapist]);
  return asAdmin(`select staff_set_therapist_week($1, $2, $3, $4, 'New rota', true) as r`,
    [therapist, JSON.stringify(WEEK(days)), JSON.stringify(BREAKS.filter((b) => days.includes(b.day_of_week))), v]);
};

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
  deepTissue = (await q(`select id from services where slug = 'deep-tissue'`))[0].id;
  therapists = (await q(`select id from therapists order by sort_order`)).map((r) => r.id);
}, 180_000);

afterAll(async () => {
  await database?.stop();
});

describe('schedule changes racing guests and payments', () => {
  it('time off against a guest reserving the time: the change always lands; a reservation that slipped in cannot be paid for', async () => {
    for (const time of ['09:00', '10:30', '15:30']) {
      const start = at(upcoming(MON, 1), time);
      const [change, hold] = await race([timeOff(therapists[0], start, new Date(start.getTime() + 3_600_000)), guestHold(start, therapists[0])]);
      expect(change.ok).toBe(true);
      if (!hold.ok) {
        expect(hold).toMatchObject({ error: 'slot_unavailable', detail: 'time_off' });
      } else {
        const { reference, amount } = await pay(hold.row);
        const [{ r }] = await q(`select record_payment_result('mock', $1, 'success', $2, 'NGN') as r`, [reference, amount]);
        expect(r.status).toBe('refund_required');
        expect(await paymentRow(reference)).toMatchObject({ needs_refund_reason: 'schedule_changed', needs_refund_detail: 'time_off', appointment_id: null });
      }
    }
  });

  it('time off against a payment completing: either the booking exists and is listed, or the payment is flagged — never both, never neither', async () => {
    const start = at(upcoming(TUE, 1), '10:30');
    const g = await guestMidPayment(start, therapists[1]);
    const [change, payment] = await race([timeOff(therapists[1], at(upcoming(TUE, 1), '09:00'), at(upcoming(TUE, 1), '12:00')), paymentSucceeds(g.reference, g.amount)]);
    expect(change.ok && payment.ok).toBe(true);
    const p = await paymentRow(g.reference);
    if (p.appointment_id) {
      expect(await appointment(p.appointment_id)).toMatchObject({ status: 'confirmed' });
      expect(await conflictsOf(p.appointment_id)).toEqual(['time_off']);
      expect(p.needs_refund).toBe(false);
    } else {
      expect(p).toMatchObject({ needs_refund: true, needs_refund_reason: 'schedule_changed', needs_refund_detail: 'time_off' });
    }
  });

  it('a duration change against a payment completing: the booking keeps its length, or the payment is flagged', async () => {
    const start = at(upcoming(SAT, 1), '10:30');
    const g = await guestMidPayment(start, therapists[1]);
    const [change, payment] = await race([await saveService(swedish, { duration_minutes: 90 }), paymentSucceeds(g.reference, g.amount)]);
    expect(change.ok && payment.ok).toBe(true);
    const p = await paymentRow(g.reference);
    if (p.appointment_id) {
      const a = await appointment(p.appointment_id);
      expect(new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()).toBe(60 * 60_000);
      expect(p.needs_refund).toBe(false);
    } else {
      expect(p).toMatchObject({ needs_refund: true, needs_refund_reason: 'service_changed', needs_refund_detail: 'duration' });
    }
    expect((await one(await saveService(swedish, { duration_minutes: 60 }))).ok).toBe(true);
  });
});

describe('schedule changes racing staff', () => {
  it('time off against a staff reschedule onto that time', async () => {
    const [made] = await race([phoneBooking(at(upcoming(WED, 1), '09:00'), therapists[2])]);
    const id = (made as any).row.id;
    const target = at(upcoming(WED, 1), '15:30');
    const [change, move] = await race([
      timeOff(therapists[2], at(upcoming(WED, 1), '15:00'), at(upcoming(WED, 1), '18:00')),
      asAdmin(`select * from staff_reschedule_appointment($1, $2, 'Guest asked', $3)`, [id, target.toISOString(), await version(id)]),
    ]);
    expect(change.ok).toBe(true);
    const a = await appointment(id);
    expect(a.status).toBe('confirmed');
    if (move.ok) {
      expect(new Date(a.starts_at).toISOString()).toBe(target.toISOString());
      expect(await conflictsOf(id)).toEqual(['time_off']);
    } else {
      expect(move).toMatchObject({ error: 'schedule_rule', detail: 'time_off' });
      expect(new Date(a.starts_at).toISOString()).toBe(at(upcoming(WED, 1), '09:00').toISOString());
    }
  });

  it('a blackout against a phone booking', async () => {
    const start = at(upcoming(THU, 1), '10:30');
    const [change, made] = await race([
      asAdmin(`select staff_add_blackout($1, $2, 'Water outage', 'Closed for repairs', true) as r`, [at(upcoming(THU, 1), '10:00').toISOString(), at(upcoming(THU, 1), '12:00').toISOString()]),
      phoneBooking(start, therapists[3]),
    ]);
    expect(change.ok).toBe(true);
    if (made.ok) expect(await conflictsOf(made.row.id)).toEqual(['blackout']);
    else expect(made).toMatchObject({ error: 'slot_unavailable', detail: 'blackout' });
  });

  it('a shift change against a phone booking that day; existing bookings that day are kept and listed', async () => {
    const [existing] = await race([phoneBooking(at(upcoming(FRI, 1), '09:00'), therapists[0])]);
    const [change, made] = await race([await setWeek(therapists[0], [1, 2, 3, 4, 6]), phoneBooking(at(upcoming(FRI, 1), '15:30'), therapists[0])]);
    expect(change.ok).toBe(true);
    expect(await appointment((existing as any).row.id)).toMatchObject({ status: 'confirmed' });
    expect(await conflictsOf((existing as any).row.id)).toEqual(['outside_shift']);
    if (made.ok) expect(await conflictsOf(made.row.id)).toEqual(['outside_shift']);
    else expect(made).toMatchObject({ error: 'slot_unavailable', detail: 'outside_shift' });
    expect((await one(await setWeek(therapists[0], [1, 2, 3, 4, 5, 6]))).ok).toBe(true);
    expect(await conflictsOf((existing as any).row.id)).toEqual([]);
  });

  it('two edits of the same therapist week from the same version: one wins, one is stale', async () => {
    // Both are real changes (a no-op would leave the version as it was).
    const [a, b] = await race([await setWeek(therapists[1], [1, 2, 3, 4, 5]), await setWeek(therapists[1], [1, 2, 3, 4, 6])]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ error: 'stale_record' });
    expect((await one(await setWeek(therapists[1], [1, 2, 3, 4, 5, 6]))).ok).toBe(true);
  });
});

describe('deactivations with future bookings', () => {
  it('a service deactivated while a phone booking for it is made: bookings kept and listed', async () => {
    const [existing] = await race([phoneBooking(at(upcoming(MON, 2), '15:30'), therapists[3], { service: deepTissue })]);
    const [change, made] = await race([await saveService(deepTissue, { is_active: false }), phoneBooking(at(upcoming(MON, 2), '10:30'), therapists[2], { service: deepTissue })]);
    expect(change.ok).toBe(true);
    expect(await appointment((existing as any).row.id)).toMatchObject({ status: 'confirmed', service_id: deepTissue });
    expect(await conflictsOf((existing as any).row.id)).toEqual(['service_inactive']);
    if (made.ok) expect(await conflictsOf(made.row.id)).toEqual(['service_inactive']);
    else expect(made).toMatchObject({ error: 'service_unavailable' });
    expect((await one(await saveService(deepTissue, { is_active: true }))).ok).toBe(true);
  });

  it('a therapist deactivated while a booking is moved to them', async () => {
    const [made] = await race([phoneBooking(at(upcoming(TUE, 2), '10:30'), therapists[2])]);
    const id = (made as any).row.id;
    const target = at(upcoming(TUE, 2), '15:30');
    const [change, move] = await race([
      await saveTherapist(therapists[3], false),
      asAdmin(`select * from staff_reschedule_appointment($1, $2, 'Guest prefers them', $3, $4)`, [id, target.toISOString(), await version(id), therapists[3]]),
    ]);
    expect(change.ok).toBe(true);
    const a = await appointment(id);
    expect(a.status).toBe('confirmed');
    if (move.ok) {
      expect(a.therapist_id).toBe(therapists[3]);
      expect(await conflictsOf(id)).toEqual(['therapist_inactive']);
    } else {
      expect(move).toMatchObject({ error: 'therapist_unavailable' });
      expect(a.therapist_id).toBe(therapists[2]);
    }
    expect((await one(await saveTherapist(therapists[3], true))).ok).toBe(true);
  });

  it('an in-home area deactivated while an in-home booking there is made; existing in-home bookings kept and listed', async () => {
    const [{ id: vi }] = await q(`select id from dispatch_zones where key = 'vi'`);
    const [existing] = await race([phoneBooking(at(upcoming(WED, 2), '15:30'), therapists[1], { zone: vi })]);
    const [change, made] = await race([await saveZone(vi, false), phoneBooking(at(upcoming(WED, 2), '10:30'), therapists[0], { zone: vi })]);
    expect(change.ok).toBe(true);
    expect(await appointment((existing as any).row.id)).toMatchObject({ status: 'confirmed', dispatch_zone_id: vi });
    expect(await conflictsOf((existing as any).row.id)).toEqual(['zone_inactive']);
    if (made.ok) expect(await conflictsOf(made.row.id)).toEqual(['zone_inactive']);
    else expect(made).toMatchObject({ error: 'dispatch_zone_required' });
    expect((await one(await saveZone(vi, true))).ok).toBe(true);
  });
});

describe('after every race', () => {
  it('no booking was cancelled or moved by a schedule change, and nothing overlaps', async () => {
    expect(await q(`select id from appointments where status = 'cancelled'`)).toEqual([]);
    const moved = await q(`select distinct action from audit_log where entity_type = 'appointments' and actor_kind = 'staff'
      and action not in ('appointment.created_by_staff', 'appointment.rescheduled')`);
    expect(moved).toEqual([]);
    expect(await overlappingPairs()).toBe(0);
  });
});
