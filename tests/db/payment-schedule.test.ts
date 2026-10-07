import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createTestDb, one, rows } from './harness';
import { at, upcoming } from './dates';

// A paid hold must still satisfy the scheduling rules at the moment it becomes
// an appointment. Each test holds a slot, starts payment, changes one rule, and
// then delivers a successful payment result.
//
// Seeded rules: open 09:00-21:00 daily; therapists work Mon-Sat 09:00-20:00 with a
// 13:00-14:00 break; Swedish massage is 60 minutes + 15 minute buffer; 30-minute grid.

let db: PGlite;
let swedish: string;
let A: string;
let B: string;
const PRICE = 4_000_000;

interface Slot { date: string; time: string; start: Date; dow: number }
let slotIndex = 0;
const TIMES = ['09:00', '11:00', '14:00', '16:00', '18:00'];
function nextSlot(): Slot {
  const i = slotIndex++;
  const dow = 1 + (Math.floor(i / TIMES.length) % 6);
  const date = upcoming(dow, Math.floor(i / (TIMES.length * 6)));
  const time = TIMES[i % TIMES.length];
  return { date, time, start: at(date, time), dow };
}

const service = <T>(fn: () => Promise<T>) => asRole(db, 'service_role', null, fn);
let guest = 0;

/** A held slot with customer details and a started payment. */
async function paying(slot = nextSlot(), therapist = A) {
  const hold = await service(() => one(db, `select * from request_booking_hold($1, $2, $3)`, [swedish, slot.start.toISOString(), therapist]));
  await service(() => db.query(`select attach_customer_to_hold($1, 'Test Guest', $2, '+2348000000000')`, [hold.hold_token, `sched${++guest}@example.com`]));
  const { r } = await service(() => one(db, `select begin_hold_payment($1, 'paystack', true) as r`, [hold.hold_token]));
  return { slot, hold, reference: r.reference as string };
}

const succeed = async (reference: string) =>
  (await service(() => one(db, `select record_payment_result('paystack', $1, 'success', $2, 'NGN', now(), 'TX-1', 'card') as r`, [reference, PRICE]))).r;

async function expectRefused(p: { hold: any; reference: string }, reason: string, detail: string | null) {
  const outcome = await succeed(p.reference);
  expect(outcome).toMatchObject({ status: 'refund_required', reason, appointment: null });
  expect(await one(db, `select status, needs_refund, needs_refund_reason, needs_refund_detail, appointment_id from payments where provider_reference = $1`, [p.reference])).toEqual({
    status: 'succeeded', needs_refund: true, needs_refund_reason: reason, needs_refund_detail: detail, appointment_id: null,
  });
  expect(await rows(db, `select id from appointments where hold_id = $1`, [p.hold.id])).toEqual([]);
  expect((await one(db, `select status from booking_holds where id = $1`, [p.hold.id])).status).not.toBe('converted');
}

async function expectConfirmed(p: { hold: any; reference: string }) {
  expect(await succeed(p.reference)).toMatchObject({ status: 'confirmed' });
  expect(await rows(db, `select id from appointments where hold_id = $1`, [p.hold.id])).toHaveLength(1);
}

const expire = (holdId: string) => db.query(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [holdId]);

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`delete from appointments`);
  await db.query(`update business_settings set online_payment_enabled = true, payment_mode = 'full'`);
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  A = (await one(db, `select id from therapists where sort_order = 1`)).id;
  B = (await one(db, `select id from therapists where sort_order = 2`)).id;
});

describe('schedule rules are re-checked when a paid hold becomes an appointment', () => {
  it('confirms when nothing relevant changed', async () => {
    await expectConfirmed(await paying());
  });

  it('therapist time off added over the slot', async () => {
    const p = await paying();
    await db.query(`insert into therapist_time_off (therapist_id, starts_at, ends_at, reason) values ($1, $2, $3, 'sick')`, [
      A, at(p.slot.date, '00:00').toISOString(), at(p.slot.date, '23:59').toISOString(),
    ]);
    await expectRefused(p, 'schedule_changed', 'time_off');
    await db.query(`delete from therapist_time_off`);
  });

  it('time off that only partly overlaps the treatment', async () => {
    const p = await paying();
    const from = new Date(p.slot.start.getTime() + 45 * 60_000);
    await db.query(`insert into therapist_time_off (therapist_id, starts_at, ends_at) values ($1, $2, $3)`, [A, from.toISOString(), new Date(from.getTime() + 3_600_000).toISOString()]);
    await expectRefused(p, 'schedule_changed', 'time_off');
    await db.query(`delete from therapist_time_off`);
  });

  it('business blackout date added', async () => {
    const p = await paying();
    const { id } = await one(db, `insert into blackout_dates (starts_at, ends_at, reason) values ($1, $2, 'public holiday') returning id`, [
      at(p.slot.date, '00:00').toISOString(), at(p.slot.date, '23:59').toISOString(),
    ]);
    await expectRefused(p, 'schedule_changed', 'blackout');
    await db.query(`delete from blackout_dates where id = $1`, [id]);
  });

  it('a break added over the slot', async () => {
    const p = await paying();
    const [h, m] = p.slot.time.split(':').map(Number);
    const { id } = await one(db, `insert into therapist_breaks (therapist_id, day_of_week, start_time, end_time) values ($1, $2, $3, $4) returning id`, [
      A, p.slot.dow, `${String(h).padStart(2, '0')}:${String(m + 30).padStart(2, '0')}`, `${String(h + 1).padStart(2, '0')}:30`,
    ]);
    await expectRefused(p, 'schedule_changed', 'on_break');
    await db.query(`delete from therapist_breaks where id = $1`, [id]);
  });

  it('the therapist\'s shift for that day removed', async () => {
    const p = await paying();
    await db.query(`update therapist_schedules set day_of_week = 0 where therapist_id = $1 and day_of_week = $2`, [A, p.slot.dow]);
    await expectRefused(p, 'schedule_changed', 'outside_shift');
    await db.query(`update therapist_schedules set day_of_week = $2 where therapist_id = $1 and day_of_week = 0`, [A, p.slot.dow]);
  });

  it('the shift shortened so the treatment no longer fits', async () => {
    const p = await paying();
    const [h] = p.slot.time.split(':').map(Number);
    await db.query(`update therapist_schedules set end_time = $3 where therapist_id = $1 and day_of_week = $2`, [A, p.slot.dow, `${String(h).padStart(2, '0')}:30`]);
    await expectRefused(p, 'schedule_changed', 'outside_shift');
    await db.query(`update therapist_schedules set end_time = '20:00' where therapist_id = $1 and day_of_week = $2`, [A, p.slot.dow]);
  });

  it('the business closed on that weekday', async () => {
    const p = await paying();
    await db.query(`update business_hours set is_closed = true where day_of_week = $1`, [p.slot.dow]);
    await expectRefused(p, 'schedule_changed', 'outside_business_hours');
    await db.query(`update business_hours set is_closed = false where day_of_week = $1`, [p.slot.dow]);
  });

  it('opening hours narrowed past the slot', async () => {
    const p = await paying();
    const [h] = p.slot.time.split(':').map(Number);
    await db.query(`update business_hours set opens_at = $2 where day_of_week = $1`, [p.slot.dow, `${String(h).padStart(2, '0')}:30`]);
    await expectRefused(p, 'schedule_changed', 'outside_business_hours');
    await db.query(`update business_hours set opens_at = '09:00' where day_of_week = $1`, [p.slot.dow]);
  });

  it('the minimum notice raised beyond the slot', async () => {
    const p = await paying();
    await db.query(`update business_settings set min_lead_minutes = 60 * 24 * 90`);
    await expectRefused(p, 'schedule_changed', 'too_soon');
    await db.query(`update business_settings set min_lead_minutes = 120`);
  });

  it('the booking window shortened below the slot', async () => {
    const p = await paying();
    await db.query(`update business_settings set max_advance_days = 1`);
    await expectRefused(p, 'schedule_changed', 'too_far');
    await db.query(`update business_settings set max_advance_days = 60`);
  });

  it('the booking grid changed so the start time is no longer offered', async () => {
    const p = await paying();
    await db.query(`update business_settings set slot_interval_minutes = 13`);
    await expectRefused(p, 'schedule_changed', 'off_grid');
    await db.query(`update business_settings set slot_interval_minutes = 30`);
  });

  it('the service duration changed', async () => {
    const p = await paying();
    await db.query(`update services set duration_minutes = 90 where id = $1`, [swedish]);
    await expectRefused(p, 'service_changed', 'duration');
    await db.query(`update services set duration_minutes = 60 where id = $1`, [swedish]);
  });

  it('the service turnover buffer changed', async () => {
    const p = await paying();
    await db.query(`update services set buffer_minutes = 30 where id = $1`, [swedish]);
    await expectRefused(p, 'service_changed', 'duration');
    await db.query(`update services set buffer_minutes = 15 where id = $1`, [swedish]);
  });

  it('the service withdrawn', async () => {
    const p = await paying();
    await db.query(`update services set is_active = false where id = $1`, [swedish]);
    await expectRefused(p, 'service_changed', 'inactive');
    await db.query(`update services set is_active = true where id = $1`, [swedish]);
  });

  it('the therapist deactivated, or no longer offering the service', async () => {
    const gone = await paying();
    await db.query(`update therapists set is_active = false where id = $1`, [A]);
    await expectRefused(gone, 'therapist_unavailable', null);
    await db.query(`update therapists set is_active = true where id = $1`, [A]);

    const unlinked = await paying();
    await db.query(`delete from therapist_services where therapist_id = $1 and service_id = $2`, [A, swedish]);
    await expectRefused(unlinked, 'therapist_unavailable', null);
    await db.query(`insert into therapist_services (therapist_id, service_id) values ($1, $2)`, [A, swedish]);
  });

  it('another reservation now has the slot (still reported as slot_retaken)', async () => {
    const p = await paying();
    await expire(p.hold.id);
    await paying(p.slot);
    await expectRefused(p, 'slot_retaken', null);
  });
});

describe('changes that do not affect the slot leave the booking alone', () => {
  it('time off for another therapist, on another day, or next to the slot', async () => {
    const p = await paying();
    const end = new Date(p.slot.start.getTime() + 60 * 60_000);
    await db.query(`insert into therapist_time_off (therapist_id, starts_at, ends_at) values ($1, $2, $3)`, [B, at(p.slot.date, '00:00').toISOString(), at(p.slot.date, '23:59').toISOString()]);
    const otherDay = new Date(p.slot.start.getTime() + 24 * 3_600_000);
    await db.query(`insert into therapist_time_off (therapist_id, starts_at, ends_at) values ($1, $2, $3)`, [A, otherDay.toISOString(), new Date(otherDay.getTime() + 3_600_000).toISOString()]);
    // Starts exactly when the treatment ends: touching, not overlapping.
    await db.query(`insert into therapist_time_off (therapist_id, starts_at, ends_at) values ($1, $2, $3)`, [A, end.toISOString(), new Date(end.getTime() + 600_000).toISOString()]);
    await expectConfirmed(p);
    await db.query(`delete from therapist_time_off`);
  });

  it('a rule changed and changed back before payment', async () => {
    const p = await paying();
    await db.query(`update business_hours set is_closed = true where day_of_week = $1`, [p.slot.dow]);
    await db.query(`update business_hours set is_closed = false where day_of_week = $1`, [p.slot.dow]);
    await expectConfirmed(p);
  });
});

describe('minimum notice and booking window are measured from when the booking was made', () => {
  // A notice period 5 minutes longer than the time now remaining before the slot.
  const leadJustBeyondNow = (start: Date) => Math.ceil((start.getTime() - Date.now()) / 60_000) + 5;

  it('a live hold is not refused merely because time passed while the guest was paying', async () => {
    const p = await paying();
    // The guest held the slot 10 minutes ago, when the notice period was still met.
    await db.query(`update booking_holds set created_at = now() - interval '10 minutes' where id = $1`, [p.hold.id]);
    await db.query(`update business_settings set min_lead_minutes = $1`, [leadJustBeyondNow(p.slot.start)]);
    try {
      await expectConfirmed(p);
    } finally {
      await db.query(`update business_settings set min_lead_minutes = 120`);
    }
  });

  it('a lapsed hold is treated as a new booking made now, so the notice period applies from now', async () => {
    const p = await paying();
    await db.query(`update booking_holds set created_at = now() - interval '10 minutes' where id = $1`, [p.hold.id]);
    await expire(p.hold.id);
    await db.query(`update business_settings set min_lead_minutes = $1`, [leadJustBeyondNow(p.slot.start)]);
    try {
      await expectRefused(p, 'schedule_changed', 'too_soon');
    } finally {
      await db.query(`update business_settings set min_lead_minutes = 120`);
    }
  });

  it('a lapsed hold whose slot still satisfies every rule is honoured', async () => {
    const p = await paying();
    await expire(p.hold.id);
    await expectConfirmed(p);
  });
});

describe('the Phase 2 rule set is unchanged', () => {
  it('availability and hold requests give the same answers as before', async () => {
    const slot = nextSlot();
    const listed = await asRole(db, 'anon', null, () => rows(db, `select starts_at from get_available_slots($1, $2, $3)`, [swedish, slot.date, B]));
    expect(listed).toHaveLength(18);
    const hold = await service(() => one(db, `select * from request_booking_hold($1, $2, $3)`, [swedish, slot.start.toISOString(), B]));
    // A guest's own hold still hides the slot from the public listing (documented carry-forward).
    const after = await asRole(db, 'anon', null, () => rows(db, `select starts_at from get_available_slots($1, $2, $3)`, [swedish, slot.date, B]));
    expect(after.some((r) => new Date(r.starts_at).getTime() === slot.start.getTime())).toBe(false);
    expect(hold.status).toBe('active');
  });

  it('guests cannot call the new rule function or take the schedule lock', async () => {
    for (const call of [
      `select private.slot_block_reason('${A}', now(), now(), now(), now(), null)`,
      `select private.lock_schedule_rules_for_change()`,
      `select private.schedule_rules_lock_key()`,
    ]) {
      await expect(asRole(db, 'anon', null, () => db.query(call))).rejects.toThrow(/permission denied|trigger functions can only be called as triggers/);
      await expect(asRole(db, 'authenticated', null, () => db.query(call))).rejects.toThrow(/permission denied|trigger functions can only be called as triggers/);
    }
  });
});

describe('the in-home area is re-checked at payment (5c hardening)', () => {
  /** An in-home hold in `zoneKey`, with customer details and a started payment. */
  async function payingAtHome(zoneKey: string) {
    const slot = nextSlot();
    const zone = (await one(db, `select id from dispatch_zones where key = $1`, [zoneKey])).id;
    const hold = await service(() => one(db, `select * from request_booking_hold($1, $2, $3, 'mobile', $4)`, [swedish, slot.start.toISOString(), A, zone]));
    await service(() => db.query(`select attach_customer_to_hold($1, 'Home Guest', $2, '+2348000000000')`, [hold.hold_token, `home${++guest}@example.com`]));
    const { r } = await service(() => one(db, `select begin_hold_payment($1, 'paystack', true, '12 Akin Adesola Street') as r`, [hold.hold_token]));
    return { slot, hold, zone, reference: r.reference as string, amount: Number(r.amount_minor) };
  }
  const succeedFor = async (p: { reference: string; amount: number }) =>
    (await service(() => one(db, `select record_payment_result('paystack', $1, 'success', $2, 'NGN', now(), 'TX-2', 'card') as r`, [p.reference, p.amount]))).r;

  it('an area deactivated before the payment completes: no booking, payment flagged zone_unavailable', async () => {
    const p = await payingAtHome('vi');
    await db.query(`update dispatch_zones set is_active = false where id = $1`, [p.zone]);
    try {
      expect(await succeedFor(p)).toMatchObject({ status: 'refund_required', reason: 'zone_unavailable', appointment: null });
      expect(await one(db, `select needs_refund, needs_refund_reason, needs_refund_detail, appointment_id from payments where provider_reference = $1`, [p.reference]))
        .toEqual({ needs_refund: true, needs_refund_reason: 'zone_unavailable', needs_refund_detail: null, appointment_id: null });
      expect(await rows(db, `select id from appointments where hold_id = $1`, [p.hold.id])).toEqual([]);
    } finally {
      await db.query(`update dispatch_zones set is_active = true where id = $1`, [p.zone]);
    }
  });

  it('an active area, even with a changed fee, confirms with the fee the guest paid', async () => {
    const p = await payingAtHome('lekki');
    await db.query(`update dispatch_zones set fee_minor = fee_minor + 500000 where id = $1`, [p.zone]);
    try {
      expect(await succeedFor(p)).toMatchObject({ status: 'confirmed' });
      const a = await one(db, `select dispatch_fee_minor, total_minor from appointments where hold_id = $1`, [p.hold.id]);
      expect(Number(a.dispatch_fee_minor)).toBe(1000000);
      expect(Number(a.total_minor)).toBe(p.amount);
    } finally {
      await db.query(`update dispatch_zones set fee_minor = fee_minor - 500000 where id = $1`, [p.zone]);
    }
  });

  it('a studio booking is unaffected by any area change', async () => {
    const p = await paying();
    await db.query(`update dispatch_zones set is_active = false`);
    try {
      await expectConfirmed(p);
    } finally {
      await db.query(`update dispatch_zones set is_active = true`);
    }
  });
});

describe('guest reservations take the schedule-rules lock (5c hardening)', () => {
  it('request_booking_hold takes it shared, before its availability decision', async () => {
    const src = (await one(db, `select prosrc from pg_proc where proname = 'request_booking_hold'`)).prosrc as string;
    const lock = src.indexOf('pg_advisory_xact_lock_shared(private.schedule_rules_lock_key())');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(src.indexOf('private.lock_therapist'));
    expect(lock).toBeLessThan(src.indexOf('private.slot_block_reason'));
  });
});