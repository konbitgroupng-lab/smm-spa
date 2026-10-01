import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { groupSlots } from '../../src/services/bookingService';
import { asRole, createTestDb, one, rows } from './harness';
import { at, localTime, upcoming, FRI, MON, SAT, SUN, THU, TUE, WED } from './dates';

// Seeded rules: open 09:00-21:00 daily; therapists work Mon-Sat 09:00-20:00 with a
// 13:00-14:00 break; 60-minute services with a 15-minute buffer; 30-minute grid.

let db: PGlite;
let swedish: string;
let ultimate: string; // 240-minute package
let A: string;
let B: string;
let customerId: string;

async function slots(date: string, therapistId: string | null = A, serviceId = swedish): Promise<string[]> {
  const result = await asRole(db, 'anon', null, () =>
    rows(db, `select * from get_available_slots($1, $2, $3)`, [serviceId, date, therapistId]),
  );
  return result.filter((r) => therapistId === null || r.therapist_id === therapistId).map((r) => localTime(r.starts_at));
}

function requestHold(startsAt: Date, therapistId: string | null = A, extra: { zone?: string; location?: string; replace?: string } = {}) {
  return asRole(db, 'service_role', null, () =>
    one(db, `select * from request_booking_hold($1, $2, $3, $4, $5, $6)`, [
      swedish, startsAt.toISOString(), therapistId, extra.location ?? 'sanctuary', extra.zone ?? null, extra.replace ?? null,
    ]),
  );
}

async function reasonFor(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err: any) {
    return `${err.message}:${err.detail ?? ''}`;
  }
  return 'no error';
}

function book(therapistId: string, startsAt: Date) {
  return one(
    db,
    `insert into appointments (customer_id, service_id, therapist_id, starts_at, ends_at, blocked_until, status, price_minor)
     values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '60 minutes', $4::timestamptz + interval '75 minutes', 'confirmed', 4000000)
     returning id`,
    [customerId, swedish, therapistId, startsAt.toISOString()],
  );
}

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`delete from appointments`); // start from an empty diary
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  ultimate = (await one(db, `select id from services where slug = 'pkg-ultimate'`)).id;
  A = (await one(db, `select id from therapists where sort_order = 1`)).id;
  B = (await one(db, `select id from therapists where sort_order = 2`)).id;
  customerId = (await one(db, `select id from customers where email = 'demo.bola@example.com'`)).id;
});

describe('availability listing', () => {
  it('offers grid slots inside the shift, skipping the break, in business time', async () => {
    const date = upcoming(MON);
    const result = await slots(date);
    expect(result).toEqual([
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', // 12:30 would run into the 13:00 break
      '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', // 19:30 would end after the shift
    ]);
    // 09:00 in Lagos is 08:00 UTC.
    const first = await asRole(db, 'anon', null, () => one(db, `select starts_at from get_available_slots($1, $2, $3) limit 1`, [swedish, date, A]));
    expect(new Date(first.starts_at).toISOString()).toBe(`${date}T08:00:00.000Z`);
  });

  it('returns nothing on days without a shift or when the business is closed', async () => {
    expect(await slots(upcoming(SUN))).toEqual([]);

    await db.query(`update business_hours set is_closed = true where day_of_week = 2`);
    expect(await slots(upcoming(TUE))).toEqual([]);
    await db.query(`update business_hours set is_closed = false where day_of_week = 2`);
  });

  it('respects opening hours that are narrower than the shift', async () => {
    await db.query(`update business_hours set opens_at = '10:00', closes_at = '18:00' where day_of_week = 3`);
    const result = await slots(upcoming(WED));
    await db.query(`update business_hours set opens_at = '09:00', closes_at = '21:00' where day_of_week = 3`);
    expect(result[0]).toBe('10:00');
    expect(result.at(-1)).toBe('17:00');
  });

  it('removes slots that collide with an appointment or its buffer', async () => {
    const date = upcoming(THU);
    await book(A, at(date, '10:00')); // blocked 10:00-11:15
    const result = await slots(date);
    // 09:00 and 09:30 go too: their own buffer would run into the appointment.
    for (const taken of ['09:00', '09:30', '10:00', '10:30', '11:00']) expect(result).not.toContain(taken);
    expect(result).toContain('11:30');
    expect(await slots(date, B)).toContain('10:00'); // other therapists are unaffected
  });

  it('removes slots under an active hold and returns them once the hold expires', async () => {
    const date = upcoming(FRI);
    const hold = await requestHold(at(date, '15:00'));
    expect(await slots(date)).not.toContain('15:00');
    await db.query(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [hold.id]);
    expect(await slots(date)).toContain('15:00');
  });

  it('respects therapist time off and business blackout dates', async () => {
    const date = upcoming(SAT);
    await db.query(`insert into therapist_time_off (therapist_id, starts_at, ends_at) values ($1, $2, $3)`, [
      A, at(date, '00:00').toISOString(), at(date, '12:00').toISOString(),
    ]);
    const morningOff = await slots(date);
    expect(morningOff[0]).toBe('12:00');
    expect((await slots(date, B))[0]).toBe('09:00');

    await db.query(`insert into blackout_dates (starts_at, ends_at, reason) values ($1, $2, '[DEMO] closed')`, [
      at(date, '00:00').toISOString(), at(date, '23:59').toISOString(),
    ]);
    expect(await slots(date)).toEqual([]);
    expect(await slots(date, B)).toEqual([]);
  });

  it('lists every free therapist when none is chosen', async () => {
    const date = upcoming(MON, 1);
    await book(A, at(date, '16:00'));
    const result = await asRole(db, 'anon', null, () => rows(db, `select * from get_available_slots($1, $2)`, [swedish, date]));
    const grouped = groupSlots(result as any);
    const nine = grouped.find((s) => localTime(s.startsAt) === '09:00')!;
    const four = grouped.find((s) => localTime(s.startsAt) === '16:00')!;
    expect(nine.therapistIds).toHaveLength(4);
    expect(nine.therapistIds[0]).toBe(A); // display order
    expect(four.therapistIds).toHaveLength(3);
    expect(four.therapistIds).not.toContain(A);
  });

  it('fits long packages around the break and the end of the shift', async () => {
    expect(await slots(upcoming(TUE, 1), A, ultimate)).toEqual(['09:00', '14:00', '14:30', '15:00', '15:30', '16:00']);
  });

  it('excludes inactive services, inactive therapists and therapists who do not offer the service', async () => {
    const date = upcoming(WED, 1);
    await db.query(`update services set is_active = false where id = $1`, [ultimate]);
    expect(await slots(date, A, ultimate)).toEqual([]);
    await db.query(`update services set is_active = true where id = $1`, [ultimate]);

    await db.query(`update therapists set is_active = false where id = $1`, [B]);
    expect(await slots(date, B)).toEqual([]);
    await db.query(`update therapists set is_active = true where id = $1`, [B]);

    await db.query(`delete from therapist_services where therapist_id = $1 and service_id = $2`, [B, swedish]);
    expect(await slots(date, B)).toEqual([]);
    await db.query(`insert into therapist_services (therapist_id, service_id) values ($1, $2)`, [B, swedish]);
  });

  it('applies the minimum notice and the booking window', async () => {
    const date = upcoming(THU, 1);
    await db.query(`update business_settings set min_lead_minutes = 60 * 24 * 40`);
    expect(await slots(date)).toEqual([]);
    await db.query(`update business_settings set min_lead_minutes = 120`);
    expect((await slots(date)).length).toBeGreaterThan(0);

    expect(await slots(upcoming(MON, 9))).toEqual([]); // beyond the 60-day window
  });

  it('does not expose schedules or the hold functions to guests', async () => {
    await expect(asRole(db, 'anon', null, () => rows(db, `select * from therapist_schedules`))).rejects.toThrow(/permission denied/);
    for (const call of [
      `select request_booking_hold('${swedish}', now() + interval '3 days')`,
      `select attach_customer_to_hold(gen_random_uuid(), 'A B', 'a@example.com', '+2340000000')`,
      `select release_booking_hold(gen_random_uuid())`,
      `select consume_rate_limit('k', 1, 60)`,
      `select run_booking_maintenance()`,
      `select private.slot_block_reason('${A}', now(), now(), now())`,
    ]) {
      await expect(asRole(db, 'anon', null, () => db.query(call))).rejects.toThrow(/permission denied/);
      await expect(asRole(db, 'authenticated', null, () => db.query(call))).rejects.toThrow(/permission denied/);
    }
  });
});

describe('validated hold requests', () => {
  it('reserves a slot the listing offers', async () => {
    const date = upcoming(FRI, 1);
    const hold = await requestHold(at(date, '11:00'));
    expect(hold).toMatchObject({ status: 'active', therapist_id: A });
    expect(new Date(hold.blocked_until)).toEqual(at(date, '12:15'));
  });

  it('refuses every slot the listing would not offer, with the reason', async () => {
    const date = upcoming(SAT, 1);
    expect(await reasonFor(requestHold(at(date, '10:15')))).toBe('slot_unavailable:off_grid');
    expect(await reasonFor(requestHold(at(date, '12:30')))).toBe('slot_unavailable:on_break');
    expect(await reasonFor(requestHold(at(date, '19:30')))).toBe('slot_unavailable:outside_shift');
    expect(await reasonFor(requestHold(at(date, '07:00')))).toBe('slot_unavailable:outside_business_hours');
    expect(await reasonFor(requestHold(at(date, '23:30')))).toBe('slot_unavailable:outside_business_hours');
    expect(await reasonFor(requestHold(at(upcoming(SUN, 1), '10:00')))).toBe('slot_unavailable:outside_shift');
    expect(await reasonFor(requestHold(new Date(Date.now() + 30 * 60_000)))).toBe('slot_unavailable:too_soon');
    expect(await reasonFor(requestHold(at(upcoming(MON, 9), '10:00')))).toBe('slot_unavailable:too_far');

    await requestHold(at(date, '15:00'));
    expect(await reasonFor(requestHold(at(date, '15:30')))).toBe('slot_unavailable:slot_taken');
  });

  it('assigns the least-booked free therapist when none is chosen', async () => {
    const date = upcoming(MON, 2);
    expect((await requestHold(at(date, '10:00'), null)).therapist_id).toBe(A); // nobody booked: display order

    await book(A, at(date, '17:00')); // A now has more appointments that day than B
    expect((await requestHold(at(date, '15:00'), null)).therapist_id).toBe(B);
  });

  it('moves to the next therapist when the first is taken, and fails only when all are', async () => {
    const date = upcoming(TUE, 2);
    const start = at(date, '10:00');
    const assigned = [];
    for (let i = 0; i < 4; i++) assigned.push((await requestHold(start, null)).therapist_id);
    expect(new Set(assigned).size).toBe(4);
    expect(await reasonFor(requestHold(start, null))).toBe('slot_unavailable:slot_taken');
    expect(await slots(date, null)).not.toContain('10:00');
  });

  it('replaces the guest\'s previous hold, and keeps it if the new slot is refused', async () => {
    const date = upcoming(WED, 2);
    const first = await requestHold(at(date, '10:00'));
    const second = await requestHold(at(date, '16:00'), A, { replace: first.hold_token });
    expect((await one(db, `select status from booking_holds where id = $1`, [first.id])).status).toBe('released');
    expect(await slots(date)).toContain('10:00');

    expect(await reasonFor(requestHold(at(date, '12:30'), A, { replace: second.hold_token }))).toBe('slot_unavailable:on_break');
    expect((await one(db, `select status from booking_holds where id = $1`, [second.id])).status).toBe('active');
  });

  it('can move a hold to an overlapping time for the same therapist', async () => {
    const date = upcoming(THU, 2);
    const first = await requestHold(at(date, '10:00'));
    const moved = await requestHold(at(date, '10:30'), A, { replace: first.hold_token });
    expect(moved.status).toBe('active');
  });

  it('requires an active dispatch zone for mobile bookings', async () => {
    const date = upcoming(FRI, 2);
    expect(await reasonFor(requestHold(at(date, '10:00'), A, { location: 'mobile' }))).toBe('dispatch_zone_required:');
    const zone = (await one(db, `select id from dispatch_zones where key = 'vi'`)).id;
    const hold = await requestHold(at(date, '10:00'), A, { location: 'mobile', zone });
    expect(hold).toMatchObject({ location_type: 'mobile', dispatch_zone_id: zone });
  });
});

describe('customer details on a hold', () => {
  const attach = (token: string, name: string, email: string, phone: string) =>
    asRole(db, 'service_role', null, () => one(db, `select * from attach_customer_to_hold($1, $2, $3, $4)`, [token, name, email, phone]));

  it('creates a customer for a new email', async () => {
    const hold = await requestHold(at(upcoming(SAT, 2), '10:00'));
    const updated = await attach(hold.hold_token, '  Test Guest ', ' New.Guest@Example.com ', '+234 800 000 0000');
    const customer = await one(db, `select * from customers where id = $1`, [updated.customer_id]);
    expect(customer).toMatchObject({ full_name: 'Test Guest', email: 'new.guest@example.com', phone: '+234 800 000 0000', is_demo: false });
  });

  it('links a returning email to the existing customer without rewriting their record', async () => {
    const hold = await requestHold(at(upcoming(MON, 3), '10:00'));
    const updated = await attach(hold.hold_token, 'Someone Else', 'DEMO.BOLA@example.com', '+2349999999999');
    expect(updated.customer_id).toBe(customerId);
    const customer = await one(db, `select * from customers where id = $1`, [customerId]);
    expect(customer).toMatchObject({ full_name: '[DEMO] Bola Example', phone: '+2340000000002' });
  });

  it('rejects invalid details', async () => {
    const hold = await requestHold(at(upcoming(TUE, 3), '10:00'));
    expect(await reasonFor(attach(hold.hold_token, 'A', 'a@example.com', '+2348000000000'))).toBe('invalid_customer:');
    expect(await reasonFor(attach(hold.hold_token, 'Test Guest', 'not-an-email', '+2348000000000'))).toBe('invalid_customer:');
    expect(await reasonFor(attach(hold.hold_token, 'Test Guest', 'a@example.com', 'call me'))).toBe('invalid_customer:');
  });

  it('refuses an expired or released hold', async () => {
    const hold = await requestHold(at(upcoming(WED, 3), '10:00'));
    await db.query(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [hold.id]);
    expect(await reasonFor(attach(hold.hold_token, 'Test Guest', 'a@example.com', '+2348000000000'))).toBe('hold_expired:');
  });
});

describe('release, rate limiting and maintenance', () => {
  it('releases a hold once and frees the slot', async () => {
    const date = upcoming(THU, 3);
    const hold = await requestHold(at(date, '10:00'));
    const release = () => asRole(db, 'service_role', null, () => one(db, `select release_booking_hold($1) as released`, [hold.hold_token]));
    expect((await release()).released).toBe(true);
    expect((await release()).released).toBe(false);
    expect(await slots(date)).toContain('10:00');
  });

  it('allows up to the limit per key per window', async () => {
    const hit = (key: string) => asRole(db, 'service_role', null, async () => (await one(db, `select consume_rate_limit($1, 3, 600) as ok`, [key])).ok);
    expect([await hit('a'), await hit('a'), await hit('a'), await hit('a')]).toEqual([true, true, true, false]);
    expect(await hit('b')).toBe(true);
  });

  it('sweeps expired holds and old rate-limit counters', async () => {
    await db.query(`update booking_holds set status = 'released' where status = 'active'`);
    const hold = await requestHold(at(upcoming(FRI, 3), '10:00'));
    await db.query(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [hold.id]);
    await db.query(`insert into private.rate_limit_hits (key, window_start) values ('old', now() - interval '2 days')`);

    const { released } = await asRole(db, 'service_role', null, () => one(db, `select run_booking_maintenance() as released`));
    expect(released).toBe(1);
    expect(await rows(db, `select 1 from private.rate_limit_hits where key = 'old'`)).toEqual([]);
  });
});
