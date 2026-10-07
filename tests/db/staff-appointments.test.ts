import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createStaff, createTestDb, one, rows } from './harness';
import { at, upcoming, MON, SUN, THU, TUE, WED } from './dates';

// Phase 5b: appointment and customer operations. Every rule here is enforced
// by the database functions; the staff app only reflects them.

let db: PGlite;
const id: Record<string, string> = {};
let swedish: string;
let facial: string;
let therapistA: string; // linked to the therapist account
let therapistB: string;
let therapistC: string;
let mainland: string;

type Actor = 'anon' | 'newAccount' | 'inactiveAdmin' | 'therapist' | 'otherTherapist' | 'admin' | 'owner';
const ACTORS: Actor[] = ['anon', 'newAccount', 'inactiveAdmin', 'therapist', 'otherTherapist', 'admin', 'owner'];

async function as<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  return actor === 'anon' ? asRole(db, 'anon', null, fn) : asRole(db, 'authenticated', id[actor], fn);
}
async function outcome(actor: Actor, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await as(actor, () => db.query(sql, params));
    return 'ok';
  } catch (err: any) {
    return /permission denied/.test(err.message) ? 'denied' : err.message;
  }
}
async function detailOf(actor: Actor, sql: string, params: unknown[] = []): Promise<string | undefined> {
  try {
    await as(actor, () => db.query(sql, params));
  } catch (err: any) {
    return err.detail;
  }
  return undefined;
}

/** The version of a row, exactly as stored. */
const version = async (table: 'appointments' | 'customers', rowId: string) =>
  (await one(db, `select updated_at::text as v from ${table} where id = $1`, [rowId])).v as string;
const appt = (apptId: string) => one(db, `select * from appointments where id = $1`, [apptId]);
const lastAudit = (entityId: string) =>
  one(db, `select * from audit_log where entity_id = $1 order by id desc limit 1`, [entityId]);

interface BookingInput {
  start: Date;
  therapist?: string | null;
  service?: string;
  source?: string;
  settlement?: string;
  customerId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: 'sanctuary' | 'mobile';
  zone?: string | null;
  address?: string | null;
  notes?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
}
const BOOK_SQL = `select * from staff_create_booking(
  p_source => $1, p_settlement => $2, p_service_id => $3, p_starts_at => $4, p_reason => 'Booked by phone',
  p_therapist_id => $5, p_location_type => $6, p_dispatch_zone_id => $7, p_service_address => $8,
  p_customer_id => $9, p_customer_name => $10, p_customer_email => $11, p_customer_phone => $12,
  p_contact_name => $13, p_contact_phone => $14, p_booking_notes => $15)`;
const bookParams = (b: BookingInput) => [
  b.source ?? 'phone', b.settlement ?? 'pay_at_venue', b.service ?? swedish, b.start.toISOString(),
  b.therapist === undefined ? therapistB : b.therapist, b.location ?? 'sanctuary', b.zone ?? null, b.address ?? null,
  b.customerId ?? null, b.customerId ? null : (b.name === undefined ? 'Phone Guest' : b.name),
  b.customerId ? null : (b.email === undefined ? null : b.email), b.customerId ? null : (b.phone === undefined ? '+2348030000001' : b.phone),
  b.contactName ?? null, b.contactPhone ?? null, b.notes ?? null,
];
const book = (b: BookingInput, actor: Actor = 'admin') => as(actor, () => one(db, BOOK_SQL, bookParams(b)));

/** An appointment that has already started (inserted directly, as history). */
async function pastAppointment(therapist: string, hoursAgo: number, extra: Record<string, unknown> = {}) {
  const customer = (await one(db, `select id from customers where email = 'demo.bola@example.com'`)).id;
  const start = new Date(Date.now() - hoursAgo * 3_600_000);
  const cols = { customer_id: customer, service_id: swedish, therapist_id: therapist, starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + 3_600_000).toISOString(), blocked_until: new Date(start.getTime() + 4_500_000).toISOString(),
    status: 'confirmed', price_minor: 4000000, ...extra };
  const keys = Object.keys(cols);
  return one(db, `insert into appointments (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    Object.values(cols));
}

beforeAll(async () => {
  db = await createTestDb();
  id.owner = await createStaff(db, 'owner@example.com', 'owner');
  id.admin = await createStaff(db, 'admin@example.com', 'admin');
  id.therapist = await createStaff(db, 'therapist@example.com', 'therapist');
  id.otherTherapist = await createStaff(db, 'therapist2@example.com', 'therapist');
  id.inactiveAdmin = await createStaff(db, 'inactive@example.com', 'admin', { active: false });
  id.newAccount = (await one(db, `insert into auth.users (email) values ('new@example.com') returning id`)).id;
  therapistA = (await one(db, `update therapists set profile_id = $1 where sort_order = 1 returning id`, [id.therapist])).id;
  therapistB = (await one(db, `select id from therapists where sort_order = 2`)).id;
  therapistC = (await one(db, `update therapists set profile_id = $1 where sort_order = 3 returning id`, [id.otherTherapist])).id;
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  facial = (await one(db, `select id from services where slug = 'facial-treatment'`)).id;
  mainland = (await one(db, `select id from dispatch_zones where key = 'mainland'`)).id;
  // Therapist C stops offering facials (used to test therapist checks).
  await db.query(`delete from therapist_services where therapist_id = $1 and service_id = $2`, [therapistC, facial]);
});

// ---------------------------------------------------------------------------
describe('who may call each function', () => {
  it('reads: owner/admin only; the agenda: therapists only', async () => {
    const reads = [
      `select * from staff_appointments(now(), now() + interval '7 days')`,
      `select staff_appointment_detail((select id from appointments limit 1))`,
      `select * from staff_customer_directory('ada')`,
      `select staff_customer_detail((select id from customers limit 1))`,
      `select staff_dashboard()`,
      `select staff_booking_options()`,
    ];
    for (const sql of reads) {
      for (const actor of ACTORS) {
        const expected = actor === 'owner' || actor === 'admin' ? 'ok' : actor === 'anon' ? 'denied' : 'not_authorized';
        expect(await outcome(actor, sql), `${sql} as ${actor}`).toBe(expected);
      }
    }
    for (const actor of ACTORS) {
      const expected = actor === 'therapist' || actor === 'otherTherapist' ? 'ok' : actor === 'anon' ? 'denied' : 'not_authorized';
      expect(await outcome(actor, `select * from therapist_agenda(now(), now() + interval '7 days')`), actor).toBe(expected);
    }
  });

  it('changes: owner/admin only (status: also the appointment\'s own therapist)', async () => {
    const start = at(upcoming(MON, 3), '10:00');
    for (const actor of ACTORS) {
      const result = await outcome(actor, BOOK_SQL, bookParams({ start, therapist: therapistB }));
      if (actor === 'owner' || actor === 'admin') {
        expect(result, actor).toBe('ok');
        await db.query(`update appointments set status = 'cancelled' where status = 'confirmed' and starts_at = $1`, [start.toISOString()]);
      } else {
        expect(result, actor).toBe(actor === 'anon' ? 'denied' : 'not_authorized');
      }
    }
    const target = await book({ start: at(upcoming(TUE, 3), '10:00') });
    const customer = (await one(db, `select id from customers where email = 'demo.ada@example.com'`)).id;
    const changes: [string, (v: string) => unknown[]][] = [
      [`select staff_reschedule_appointment($1, $2, 'moving it', $3)`, (v) => [target.id, at(upcoming(TUE, 3), '11:00').toISOString(), v]],
      [`select staff_cancel_appointment($1, 'guest called', $2)`, (v) => [target.id, v]],
      [`select staff_update_booking_details($1, $2, 'Name Here', '+2348011111111')`, (v) => [target.id, v]],
      [`select staff_set_settlement($1, 'paid_offline', 'paid by transfer', $2)`, (v) => [target.id, v]],
    ];
    for (const [sql, params] of changes) {
      for (const actor of ACTORS.filter((a) => a !== 'owner' && a !== 'admin')) {
        const result = await outcome(actor, sql, params(await version('appointments', target.id)));
        expect(result, `${sql} as ${actor}`).toBe(actor === 'anon' ? 'denied' : 'not_authorized');
      }
    }
    for (const actor of ACTORS.filter((a) => a !== 'owner' && a !== 'admin')) {
      expect(await outcome(actor, `select staff_create_customer('Someone', 'someone@example.com')`), actor).toBe(actor === 'anon' ? 'denied' : 'not_authorized');
      expect(await outcome(actor, `select staff_update_customer($1, $2, 'Renamed', null, '+2348011111111')`, [customer, await version('customers', customer)]), actor)
        .toBe(actor === 'anon' ? 'denied' : 'not_authorized');
    }
    expect((await appt(target.id)).status).toBe('confirmed'); // nothing above changed it
  });

  it('nobody writes appointments or customers directly', async () => {
    for (const actor of ['owner', 'admin', 'therapist'] as Actor[]) {
      expect(await outcome(actor, `update appointments set status = 'cancelled'`)).toBe('denied');
      expect(await outcome(actor, `update customers set full_name = 'x'`)).toBe('denied');
      expect(await outcome(actor, `insert into customers (full_name, phone) values ('x', '+2348011111111')`)).toBe('denied');
    }
  });
});

// ---------------------------------------------------------------------------
describe('phone and WhatsApp bookings (decision C)', () => {
  it('are confirmed with their source, settlement and staff author, and no payment record', async () => {
    const start = at(upcoming(WED, 1), '10:00');
    const created = await book({ start, source: 'whatsapp', settlement: 'paid_offline', name: 'Ngozi Caller', phone: '+2348031112222', notes: 'Prefers lavender oil' });
    expect(created).toMatchObject({
      status: 'confirmed', source: 'whatsapp', settlement: 'paid_offline', created_by: id.admin, therapist_id: therapistB,
      contact_name: 'Ngozi Caller', contact_phone: '+2348031112222', booking_notes: 'Prefers lavender oil', is_demo: false,
    });
    expect(Number(created.price_minor)).toBe(4000000);
    expect(new Date(created.ends_at).getTime() - start.getTime()).toBe(3_600_000);
    expect(await rows(db, `select id from payments where appointment_id = $1`, [created.id])).toEqual([]);
    expect((await one(db, `select status from booking_holds where id = $1`, [created.hold_id])).status).toBe('converted');
    const customer = await one(db, `select * from customers where id = $1`, [created.customer_id]);
    expect(customer).toMatchObject({ full_name: 'Ngozi Caller', email: null, phone: '+2348031112222' });
  });

  it('use the same availability rules as online bookings (no overrides)', async () => {
    const day = upcoming(MON, 2);
    expect(await detailOf('admin', BOOK_SQL, bookParams({ start: at(day, '13:00') }))).toBe('on_break');
    expect(await detailOf('admin', BOOK_SQL, bookParams({ start: at(day, '20:30') }))).toBe('outside_business_hours');
    expect(await detailOf('admin', BOOK_SQL, bookParams({ start: at(upcoming(SUN, 2), '10:00') }))).toBe('outside_shift');
    expect(await detailOf('admin', BOOK_SQL, bookParams({ start: at(day, '10:15') }))).toBe('off_grid');
    expect(await detailOf('admin', BOOK_SQL, bookParams({ start: new Date(Date.now() + 30 * 60_000) }))).toBe('too_soon');
    expect(await outcome('admin', BOOK_SQL, bookParams({ start: at(day, '10:00'), therapist: therapistC, service: facial }))).toBe('therapist_unavailable');
  });

  it('never overlap a booking or a guest\'s live hold', async () => {
    const start = at(upcoming(MON, 2), '15:00');
    await asRole(db, 'service_role', null, () => db.query(`select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), therapistB]));
    expect(await detailOf('admin', BOOK_SQL, bookParams({ start }))).toBe('slot_taken');
    // Overlapping by half an hour (with the turnover buffer) is refused too.
    expect(await detailOf('admin', BOOK_SQL, bookParams({ start: new Date(start.getTime() + 30 * 60_000) }))).toBe('slot_taken');
    // With no therapist chosen, another free therapist is assigned.
    const assigned = await book({ start, therapist: null });
    expect(assigned.therapist_id).not.toBe(therapistB);
  });

  it('mobile bookings need a zone and an address, and include the travel fee', async () => {
    const start = at(upcoming(TUE, 1), '10:00');
    expect(await outcome('admin', BOOK_SQL, bookParams({ start, location: 'mobile', zone: mainland }))).toBe('address_required');
    expect(await outcome('admin', BOOK_SQL, bookParams({ start, location: 'mobile', address: '4 Allen Avenue' }))).toBe('dispatch_zone_required');
    const created = await book({ start, location: 'mobile', zone: mainland, address: '4 Allen Avenue' });
    expect(created).toMatchObject({ location_type: 'mobile', service_address: '4 Allen Avenue' });
    expect(Number(created.total_minor)).toBe(4000000 + 300000);
  });

  it('link an existing customer by email without changing their record', async () => {
    const before = await one(db, `select * from customers where email = 'demo.ada@example.com'`);
    const created = await book({ start: at(upcoming(TUE, 1), '15:00'), name: 'Someone Else', email: 'DEMO.ADA@example.com', phone: '+2348039999999' });
    expect(created.customer_id).toBe(before.id);
    expect(created).toMatchObject({ contact_name: 'Someone Else', contact_phone: '+2348039999999' });
    const after = await one(db, `select * from customers where id = $1`, [before.id]);
    expect(after).toEqual(before);
  });

  it('refuse the online source and settlement, and invalid details', async () => {
    const start = at(upcoming(TUE, 1), '17:00');
    expect(await outcome('admin', BOOK_SQL, bookParams({ start, source: 'online' }))).toBe('invalid_source');
    expect(await outcome('admin', BOOK_SQL, bookParams({ start, settlement: 'online_payment' }))).toBe('invalid_source');
    expect(await outcome('admin', BOOK_SQL, bookParams({ start, name: 'X' }))).toBe('invalid_customer');
    expect(await outcome('admin', BOOK_SQL, bookParams({ start, phone: null, email: null }))).toBe('invalid_customer');
    expect(await outcome('admin', BOOK_SQL, bookParams({ start, phone: null, email: 'guest@example.com' }))).toBe('invalid_contact');
    expect(await outcome('admin', BOOK_SQL.replace("'Booked by phone'", "''"), bookParams({ start }))).toBe('reason_required');
  });

  it('can never be attached to a provider payment, even by server-side code', async () => {
    const created = await book({ start: at(upcoming(WED, 1), '15:00') });
    await expect(db.query(
      `insert into payments (appointment_id, provider, provider_reference, amount_minor, is_test, status) values ($1, 'mock', 'LEDGER-1', 4000000, true, 'succeeded')`,
      [created.id],
    )).rejects.toThrow(/ledger_separation/);
    const online = await one(db, `select id from appointments where source = 'online' limit 1`);
    const payment = await one(db, `insert into payments (provider, provider_reference, amount_minor, is_test) values ('mock', 'LEDGER-2', 100, true) returning id`);
    await expect(db.query(`update payments set appointment_id = $1 where id = $2`, [created.id, payment.id])).rejects.toThrow(/ledger_separation/);
    await db.query(`update payments set appointment_id = $1 where id = $2`, [online.id, payment.id]); // online bookings: allowed
    await expect(db.query(`update appointments set settlement = 'online_payment' where id = $1`, [created.id])).rejects.toThrow(/appointments_source_settlement/);
  });
});

// ---------------------------------------------------------------------------
describe('rescheduling (decision E)', () => {
  const RESCHEDULE = `select * from staff_reschedule_appointment($1, $2, $3, $4, $5, $6)`;
  const move = (actor: Actor, apptId: string, start: Date, v: string, therapist: string | null = null, override = false, reason = 'guest asked') =>
    as(actor, () => one(db, RESCHEDULE, [apptId, start.toISOString(), reason, v, therapist, override]));

  it('moves the booking, keeping its length and buffer, and records old and new', async () => {
    const created = await book({ start: at(upcoming(MON, 4), '10:00') });
    const moved = await move('admin', created.id, at(upcoming(MON, 4), '15:00'), await version('appointments', created.id), therapistA);
    expect(moved).toMatchObject({ therapist_id: therapistA, status: 'confirmed' });
    expect(new Date(moved.starts_at).toISOString()).toBe(at(upcoming(MON, 4), '15:00').toISOString());
    expect(new Date(moved.blocked_until).getTime() - new Date(moved.starts_at).getTime()).toBe(75 * 60_000);
    const entry = await lastAudit(created.id);
    expect(entry).toMatchObject({ action: 'appointment.rescheduled', reason: 'guest asked', actor_id: id.admin, context: {} });
    expect(entry.changes.therapist_id).toEqual({ old: therapistB, new: therapistA });
    expect(Object.keys(entry.changes).sort()).toEqual(['blocked_until', 'ends_at', 'starts_at', 'therapist_id']);
  });

  it('may move within its own time (the booking does not block itself)', async () => {
    const created = await book({ start: at(upcoming(MON, 4), '17:00') });
    const moved = await move('owner', created.id, at(upcoming(MON, 4), '17:30'), await version('appointments', created.id));
    expect(new Date(moved.starts_at).toISOString()).toBe(at(upcoming(MON, 4), '17:30').toISOString());
  });

  it('a scheduling rule needs an explicit override, which is recorded', async () => {
    const created = await book({ start: at(upcoming(TUE, 4), '10:00') });
    const breakTime = at(upcoming(TUE, 4), '13:00');
    const v = await version('appointments', created.id);
    expect(await detailOf('admin', RESCHEDULE, [created.id, breakTime.toISOString(), 'guest asked', v, null, false])).toBe('on_break');
    expect((await appt(created.id)).starts_at).toEqual(new Date(created.starts_at));
    const moved = await move('admin', created.id, breakTime, v, null, true, 'Therapist agreed to work through lunch');
    expect(new Date(moved.starts_at).toISOString()).toBe(breakTime.toISOString());
    expect(await lastAudit(created.id)).toMatchObject({
      action: 'appointment.rescheduled', reason: 'Therapist agreed to work through lunch',
      context: { override: true, overridden_rule: 'on_break' },
    });
  });

  it('never allows an overlap, override or not', async () => {
    const first = await book({ start: at(upcoming(WED, 4), '10:00') });
    const second = await book({ start: at(upcoming(WED, 4), '15:00') });
    for (const override of [false, true]) {
      expect(await detailOf('admin', RESCHEDULE, [second.id, at(upcoming(WED, 4), '10:30').toISOString(), 'x reason', await version('appointments', second.id), null, override])).toBe('slot_taken');
    }
    // Nor onto a guest's live hold.
    await asRole(db, 'service_role', null, () => db.query(`select * from request_booking_hold($1, $2, $3)`, [swedish, at(upcoming(WED, 4), '17:00').toISOString(), therapistB]));
    expect(await detailOf('admin', RESCHEDULE, [second.id, at(upcoming(WED, 4), '17:00').toISOString(), 'x reason', await version('appointments', second.id), null, true])).toBe('slot_taken');
    expect((await appt(first.id)).status).toBe('confirmed');
  });

  it('refuses stale edits, missing reasons, past times, finished bookings and unsuitable therapists', async () => {
    const created = await book({ start: at(upcoming(TUE, 5), '10:00') });
    const v = await version('appointments', created.id);
    const target = at(upcoming(TUE, 5), '11:00').toISOString();
    expect(await outcome('admin', RESCHEDULE, [created.id, target, 'ok reason', '2000-01-01 00:00:00+00', null, false])).toBe('stale_record');
    expect(await outcome('admin', RESCHEDULE, [created.id, target, ' ', v, null, false])).toBe('reason_required');
    expect(await outcome('admin', RESCHEDULE, [created.id, new Date(Date.now() - 3_600_000).toISOString(), 'ok reason', v, null, true])).toBe('start_in_past');
    expect(await outcome('admin', RESCHEDULE, [created.id, target, 'ok reason', v, therapistC, true])).toBe('ok'); // C offers Swedish
    const facialBooking = await book({ start: at(upcoming(TUE, 5), '15:00'), service: facial });
    expect(await outcome('admin', RESCHEDULE, [facialBooking.id, at(upcoming(TUE, 5), '16:00').toISOString(), 'ok reason', await version('appointments', facialBooking.id), therapistC, true])).toBe('therapist_unavailable');
    const started = await pastAppointment(therapistB, 30);
    expect(await outcome('admin', RESCHEDULE, [started.id, target, 'ok reason', await version('appointments', started.id), null, true])).toBe('appointment_started');
    await as('admin', async () => db.query(`select staff_cancel_appointment($1, 'guest cancelled', $2)`, [facialBooking.id, await version('appointments', facialBooking.id)]));
    expect(await outcome('admin', RESCHEDULE, [facialBooking.id, at(upcoming(TUE, 5), '17:00').toISOString(), 'ok reason', await version('appointments', facialBooking.id), null, true])).toBe('invalid_status');
  });
});

// ---------------------------------------------------------------------------
describe('cancellation', () => {
  it('needs a reason, frees the time at once and records who and why', async () => {
    const start = at(upcoming(THU, 6), '10:00');
    const created = await book({ start });
    expect(await outcome('admin', `select staff_cancel_appointment($1, '', $2)`, [created.id, await version('appointments', created.id)])).toBe('reason_required');
    const result = await as('admin', async () => one(db, `select staff_cancel_appointment($1, 'Guest is unwell', $2) as r`, [created.id, await version('appointments', created.id)]));
    expect(result.r).toMatchObject({ status: 'cancelled', refund_flagged: 0, settlement: 'pay_at_venue' });
    expect(await appt(created.id)).toMatchObject({ status: 'cancelled', cancellation_reason: 'Guest is unwell', cancelled_by: id.admin });
    // The same time can be booked again straight away.
    const again = await book({ start });
    expect(again.therapist_id).toBe(therapistB);
    expect(await lastAudit(created.id)).toMatchObject({ action: 'appointment.cancelled', reason: 'Guest is unwell', actor_id: id.admin });
    expect(await outcome('admin', `select staff_cancel_appointment($1, 'again please', $2)`, [created.id, await version('appointments', created.id)])).toBe('invalid_status');
  });

  it('a booking paid online is flagged for refund, never refunded', async () => {
    const online = await one(db, `select * from appointments where source = 'online' and status = 'confirmed' limit 1`);
    const payment = await one(db,
      `insert into payments (appointment_id, provider, provider_reference, amount_minor, paid_minor, is_test, status, is_demo)
       values ($1, 'mock', 'CANCEL-PAID-1', 4000000, 4000000, true, 'succeeded', true) returning *`, [online.id]);
    const result = await as('owner', async () => one(db, `select staff_cancel_appointment($1, 'Spa closed for repairs', $2) as r`, [online.id, await version('appointments', online.id)]));
    expect(result.r).toMatchObject({ refund_flagged: 1 });
    const after = await one(db, `select * from payments where id = $1`, [payment.id]);
    expect(after).toMatchObject({ status: 'succeeded', needs_refund: true, needs_refund_reason: 'appointment_cancelled', refund_status: 'none' });
    expect(Number(after.refunded_minor)).toBe(0);
    expect((await lastAudit(online.id)).context).toEqual({ refund_flagged_payments: [payment.id] });
  });
});

// ---------------------------------------------------------------------------
describe('completed and no-show (decision F)', () => {
  const SET = `select * from staff_set_appointment_status($1, $2, $3, $4)`;

  it('the appointment\'s own therapist marks it once it has started', async () => {
    const mine = await pastAppointment(therapistA, 2);
    expect(await outcome('otherTherapist', SET, [mine.id, 'completed', await version('appointments', mine.id), null])).toBe('not_found');
    expect(await outcome('therapist', SET, [mine.id, 'completed', await version('appointments', mine.id), null])).toBe('ok');
    expect(await lastAudit(mine.id)).toMatchObject({ action: 'appointment.completed', actor_id: id.therapist, actor_role: 'therapist',
      changes: { status: { old: 'confirmed', new: 'completed' } } });
    // Corrections are for owner/admin, with a reason.
    expect(await outcome('therapist', SET, [mine.id, 'no_show', await version('appointments', mine.id), 'my mistake'])).toBe('not_authorized');
    expect(await outcome('admin', SET, [mine.id, 'no_show', await version('appointments', mine.id), null])).toBe('reason_required');
    expect(await outcome('admin', SET, [mine.id, 'no_show', await version('appointments', mine.id), 'Guest never arrived'])).toBe('ok');
    expect(await lastAudit(mine.id)).toMatchObject({ action: 'appointment.status_corrected', reason: 'Guest never arrived' });
  });

  it('not before it starts, and not from cancelled', async () => {
    const future = await book({ start: at(upcoming(WED, 6), '10:00'), therapist: therapistA });
    expect(await outcome('therapist', SET, [future.id, 'completed', await version('appointments', future.id), null])).toBe('not_started');
    expect(await outcome('admin', SET, [future.id, 'no_show', await version('appointments', future.id), null])).toBe('not_started');
    const past = await pastAppointment(therapistA, 5, { status: 'cancelled' });
    expect(await outcome('admin', SET, [past.id, 'completed', await version('appointments', past.id), 'reason here'])).toBe('invalid_status');
  });

  it('a no-show put back to confirmed cannot overlap a booking made since', async () => {
    const noShow = await pastAppointment(therapistC, 1, { status: 'no_show' });
    await pastAppointment(therapistC, 1); // the time was given to someone else
    expect(await outcome('owner', SET, [noShow.id, 'confirmed', await version('appointments', noShow.id), 'Recorded wrongly'])).toBe('slot_unavailable');
  });
});

// ---------------------------------------------------------------------------
describe('booking contact versus customer master', () => {
  it('editing the booking contact never changes the customer record', async () => {
    const created = await book({ start: at(upcoming(MON, 6), '10:00'), name: 'Master Name', email: 'master@example.com', phone: '+2348030000555' });
    const before = await one(db, `select * from customers where id = $1`, [created.customer_id]);
    await as('admin', async () => db.query(`select staff_update_booking_details($1, $2, 'Driver Musa', '+2348030000666', null, 'Gate code 12')`,
      [created.id, await version('appointments', created.id)]));
    expect(await appt(created.id)).toMatchObject({ contact_name: 'Driver Musa', contact_phone: '+2348030000666', booking_notes: 'Gate code 12' });
    expect(await one(db, `select * from customers where id = $1`, [created.customer_id])).toEqual(before);
    expect(await lastAudit(created.id)).toMatchObject({ action: 'appointment.details_updated',
      changes: { contact_name: { changed: true }, contact_phone: { changed: true }, booking_notes: { changed: true } } });
  });

  it('editing the customer record never changes past bookings\' contacts', async () => {
    const created = await book({ start: at(upcoming(MON, 6), '15:00'), name: 'Original Name', email: 'original@example.com', phone: '+2348030000777' });
    await as('admin', async () => db.query(`select staff_update_customer($1, $2, 'Corrected Name', 'original@example.com', '+2348030000888', 'VIP', 'spelling')`,
      [created.customer_id, await version('customers', created.customer_id)]));
    expect(await appt(created.id)).toMatchObject({ contact_name: 'Original Name', contact_phone: '+2348030000777' });
    const detail = (await as('admin', () => one(db, `select staff_customer_detail($1) as d`, [created.customer_id]))).d;
    expect(detail.customer).toMatchObject({ full_name: 'Corrected Name', phone: '+2348030000888', staff_notes: 'VIP' });
    expect(detail.appointments[0]).toMatchObject({ contact_name: 'Original Name', source: 'phone', settlement: 'pay_at_venue' });
    expect(await lastAudit(created.customer_id)).toMatchObject({ action: 'customer.updated', reason: 'spelling', actor_id: id.admin });
  });

  it('address only for in-home bookings; contact must be valid; cancelled bookings are closed', async () => {
    const studio = await book({ start: at(upcoming(TUE, 6), '10:00') });
    const v = await version('appointments', studio.id);
    expect(await outcome('admin', `select staff_update_booking_details($1, $2, 'Name Ok', '+2348011111111', '5 Road')`, [studio.id, v])).toBe('address_not_applicable');
    expect(await outcome('admin', `select staff_update_booking_details($1, $2, 'N', '+2348011111111')`, [studio.id, v])).toBe('invalid_contact');
    expect(await outcome('admin', `select staff_update_booking_details($1, $2, 'Name Ok', 'call me')`, [studio.id, v])).toBe('invalid_contact');
    const home = await book({ start: at(upcoming(TUE, 6), '15:00'), location: 'mobile', zone: mainland, address: '1 First Street' });
    expect(await outcome('admin', `select staff_update_booking_details($1, $2, 'Name Ok', '+2348011111111', '')`, [home.id, await version('appointments', home.id)])).toBe('address_required');
    expect(await outcome('admin', `select staff_update_booking_details($1, $2, 'Name Ok', '+2348011111111', '2 Second Street')`, [home.id, await version('appointments', home.id)])).toBe('ok');
    expect((await appt(home.id)).service_address).toBe('2 Second Street');
    expect(await outcome('admin', `select staff_update_booking_details($1, $2, 'Name Ok', '+2348011111111', '3 Third')`, [home.id, '2000-01-01 00:00:00+00'])).toBe('stale_record');
  });

  it('customer records: create, edit with version, unique email, validation', async () => {
    const c = await as('owner', () => one(db, `select * from staff_create_customer('Walk In Guest', null, '+2348030001234', 'Allergic to nuts')`));
    expect(c).toMatchObject({ email: null, phone: '+2348030001234', staff_notes: 'Allergic to nuts' });
    expect(await lastAudit(c.id)).toMatchObject({ action: 'customer.created', changes: {} });
    expect(await outcome('admin', `select staff_create_customer('Dupe', 'Demo.Bola@Example.com')`)).toBe('email_in_use');
    expect(await outcome('admin', `select staff_create_customer('No Contact')`)).toBe('invalid_customer');
    expect(await outcome('admin', `select staff_update_customer($1, $2, 'Walk In Guest', 'demo.bola@example.com', null)`, [c.id, await version('customers', c.id)])).toBe('email_in_use');
    expect(await outcome('admin', `select staff_update_customer($1, '2000-01-01 00:00:00+00', 'Walk In Guest', null, '+2348030001234')`, [c.id])).toBe('stale_record');
  });

  it('the directory searches by name, email or phone digits', async () => {
    const search = async (q: string) =>
      (await as('admin', () => rows(db, `select full_name, total_count from staff_customer_directory($1)`, [q]))).map((r) => r.full_name);
    expect(await search('walk in')).toEqual(['Walk In Guest']);
    expect(await search('DEMO.BOLA')).toEqual(['[DEMO] Bola Example']);
    expect(await search('0800 0123 4')).toEqual([]); // fewer matching digits
    expect(await search('030001234')).toEqual(['Walk In Guest']);
    expect(await search('100%_')).toEqual([]); // no wildcard injection
    const all = await as('admin', () => rows(db, `select * from staff_customer_directory(null, 2, 0)`));
    expect(all).toHaveLength(2);
    expect(Number(all[0].total_count)).toBeGreaterThan(2);
    expect(await outcome('admin', `select * from staff_customer_directory(null, 1000)`)).toBe('invalid_range');
  });
});

// ---------------------------------------------------------------------------
describe('settlement of staff bookings', () => {
  it('phone bookings can be marked paid offline, with a reason; online bookings never', async () => {
    const created = await book({ start: at(upcoming(WED, 5), '10:00') });
    expect(await outcome('admin', `select staff_set_settlement($1, 'paid_offline', '', $2)`, [created.id, await version('appointments', created.id)])).toBe('reason_required');
    expect(await outcome('admin', `select staff_set_settlement($1, 'paid_offline', 'Bank transfer received', $2)`, [created.id, await version('appointments', created.id)])).toBe('ok');
    expect(await lastAudit(created.id)).toMatchObject({ action: 'appointment.settlement_changed', changes: { settlement: { old: 'pay_at_venue', new: 'paid_offline' } } });
    expect(await outcome('admin', `select staff_set_settlement($1, 'online_payment', 'trying', $2)`, [created.id, await version('appointments', created.id)])).toBe('invalid_source');
    const online = await one(db, `select id from appointments where source = 'online' limit 1`);
    expect(await outcome('admin', `select staff_set_settlement($1, 'paid_offline', 'trying', $2)`, [online.id, await version('appointments', online.id)])).toBe('invalid_source');
    expect(await rows(db, `select id from payments where appointment_id = $1`, [created.id])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('therapist data minimisation', () => {
  it('the agenda gives the booking contact, notes and a payment word — nothing from the customer master', async () => {
    const created = await book({ start: at(upcoming(THU, 5), '10:00'), therapist: therapistA, name: 'Agenda Guest',
      email: 'agenda.guest@example.com', phone: '+2348030004444', notes: 'Use the side entrance' });
    await as('admin', async () => db.query(`select staff_update_customer($1, $2, 'Agenda Guest', 'agenda.guest@example.com', '+2348030004444', 'Owes ₦5,000 from last visit')`,
      [created.customer_id, await version('customers', created.customer_id)]));
    const agenda = await as('therapist', () => rows(db, `select * from therapist_agenda(now(), now() + interval '60 days') where appointment_id = $1`, [created.id]));
    expect(agenda[0]).toMatchObject({ contact_name: 'Agenda Guest', contact_phone: '+2348030004444', booking_notes: 'Use the side entrance',
      source: 'phone', payment_state: 'to_collect' });
    const text = JSON.stringify(agenda);
    expect(text).not.toContain('agenda.guest@example.com');
    expect(text).not.toContain('Owes');
    expect(text).not.toMatch(/4000000|price|total/);
    // Another therapist sees none of it.
    expect(await as('otherTherapist', () => rows(db, `select * from therapist_agenda(now(), now() + interval '60 days') where appointment_id = $1`, [created.id]))).toEqual([]);
    // And no therapist reads the tables directly.
    for (const table of ['appointments', 'customers', 'payments', 'audit_log']) {
      expect(await as('therapist', () => rows(db, `select * from ${table}`)), table).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
describe('staff screens\' reads', () => {
  it('list, detail, dashboard and options carry what the screens need', async () => {
    const created = await book({ start: at(upcoming(MON, 5), '10:00'), source: 'whatsapp', name: 'List Guest', phone: '+2348030007777' });
    const list = await as('admin', () => rows(db, `select * from staff_appointments($1, $2)`, [at(upcoming(MON, 5), '00:00').toISOString(), at(upcoming(MON, 5), '23:59').toISOString()]));
    expect(list.find((r) => r.appointment_id === created.id)).toMatchObject({ source: 'whatsapp', settlement: 'pay_at_venue', payment_state: 'to_collect',
      customer_name: 'List Guest', contact_name: 'List Guest', therapist_id: therapistB, service_name: 'Swedish Massage' });
    const byTherapist = await as('admin', () => rows(db, `select therapist_id from staff_appointments($1, $2, $3)`, [at(upcoming(MON, 5), '00:00').toISOString(), at(upcoming(MON, 6), '00:00').toISOString(), therapistA]));
    expect(byTherapist.every((r) => r.therapist_id === therapistA)).toBe(true);
    expect(await outcome('admin', `select * from staff_appointments(now(), now() + interval '90 days')`)).toBe('invalid_range');

    const detail = (await as('admin', () => one(db, `select staff_appointment_detail($1) as d`, [created.id]))).d;
    expect(detail.appointment).toMatchObject({ reference: created.reference, source: 'whatsapp', created_by_name: '' });
    expect(detail.customer).toMatchObject({ full_name: 'List Guest' });
    expect(detail.history[0]).toMatchObject({ action: 'appointment.created_by_staff', reason: 'Booked by phone', actor_role: 'admin' });
    expect(JSON.stringify(detail)).not.toContain('checkout');

    const dash = (await as('owner', () => one(db, `select staff_dashboard() as d`))).d;
    expect(Object.keys(dash).sort()).toEqual(['awaiting_outcome', 'next_7_days', 'refunds_flagged', 'today', 'today_completed', 'today_no_show',
      'today_remaining', 'today_to_collect', 'today_total']);
    expect(dash.refunds_flagged).toBeGreaterThanOrEqual(1);

    const options = (await as('admin', () => one(db, `select staff_booking_options() as o`))).o;
    expect(options.services.length).toBe(9);
    expect(options.therapists.find((t: any) => t.id === therapistC).service_ids).not.toContain(facial);
    expect(options.timezone).toBe('Africa/Lagos');
  });
});

// ---------------------------------------------------------------------------
describe('audit coverage of staff actions', () => {
  it('every staff change is logged with its action, actor and reason; no personal values', async () => {
    const actions = (await rows(db, `select distinct action from audit_log where actor_kind = 'staff' order by 1`)).map((r) => r.action);
    for (const action of ['appointment.created_by_staff', 'appointment.rescheduled', 'appointment.cancelled', 'appointment.completed',
      'appointment.status_corrected', 'appointment.details_updated', 'appointment.settlement_changed', 'customer.created', 'customer.updated']) {
      expect(actions, action).toContain(action);
    }
    const unnamed = await rows(db, `select action, entity_type from audit_log where actor_kind = 'staff' and entity_type in ('appointments', 'customers') and action in ('insert', 'update', 'delete')`);
    expect(unnamed).toEqual([]); // nothing staff did to bookings or customers went unlabelled
    const everything = JSON.stringify(await rows(db, `select * from audit_log`));
    for (const value of ['Driver Musa', '+2348030000666', 'Gate code 12', 'Ngozi Caller', 'Prefers lavender', 'Owes', 'Use the side entrance', 'master@example.com']) {
      expect(everything, value).not.toContain(value);
    }
  });
});
