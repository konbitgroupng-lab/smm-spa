import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createTestDb, one, rows } from './harness';

let db: PGlite;
let swedish: string; // 60 minutes + 15 minute buffer
let therapistA: string;
let therapistB: string;
let customerId: string;

const MINUTE = 60_000;
let day = 20;
/** A fresh future day at 10:00 UTC for each test, so tests never collide. */
function nextSlot(): Date {
  const d = new Date(Date.now() + ++day * 24 * 60 * MINUTE);
  d.setUTCHours(10, 0, 0, 0);
  return d;
}
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MINUTE);

function hold(therapistId: string, startsAt: Date, serviceId = swedish) {
  return asRole(db, 'service_role', null, () =>
    one(db, `select * from create_booking_hold($1, $2, $3)`, [serviceId, therapistId, startsAt.toISOString()]),
  );
}

function appointment(therapistId: string, startsAt: Date, extra: { holdId?: string; status?: string } = {}) {
  return asRole(db, 'service_role', null, () =>
    one(
      db,
      `insert into appointments (customer_id, service_id, therapist_id, hold_id, starts_at, ends_at, blocked_until, status, price_minor)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 4000000) returning *`,
      [
        customerId, swedish, therapistId, extra.holdId ?? null,
        startsAt.toISOString(), plus(startsAt, 60).toISOString(), plus(startsAt, 75).toISOString(),
        extra.status ?? 'confirmed',
      ],
    ),
  );
}

beforeAll(async () => {
  db = await createTestDb();
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  therapistA = (await one(db, `select id from therapists where sort_order = 1`)).id;
  therapistB = (await one(db, `select id from therapists where sort_order = 2`)).id;
  customerId = (await one(db, `select id from customers where email = 'demo.bola@example.com'`)).id;
});

describe('booking hold creation', () => {
  it('reserves the slot for 10 minutes and blocks the turnover buffer', async () => {
    const start = nextSlot();
    const h = await hold(therapistA, start);
    expect(h.status).toBe('active');
    expect(new Date(h.ends_at)).toEqual(plus(start, 60));
    expect(new Date(h.blocked_until)).toEqual(plus(start, 75));
    const ttlMinutes = (new Date(h.expires_at).getTime() - Date.now()) / MINUTE;
    expect(ttlMinutes).toBeGreaterThan(9.5);
    expect(ttlMinutes).toBeLessThanOrEqual(10);
  });

  it('follows the configured hold length', async () => {
    await db.query(`update business_settings set hold_minutes = 5`);
    const h = await hold(therapistA, nextSlot());
    await db.query(`update business_settings set hold_minutes = 10`);
    const ttlMinutes = (new Date(h.expires_at).getTime() - Date.now()) / MINUTE;
    expect(ttlMinutes).toBeGreaterThan(4.5);
    expect(ttlMinutes).toBeLessThanOrEqual(5);
  });

  it('rejects past start times, inactive services and therapists who do not offer the service', async () => {
    await expect(hold(therapistA, new Date(Date.now() - MINUTE))).rejects.toThrow(/start_in_past/);

    await db.query(`update services set is_active = false where slug = 'nuru'`);
    const nuru = (await one(db, `select id from services where slug = 'nuru'`)).id;
    await expect(hold(therapistA, nextSlot(), nuru)).rejects.toThrow(/service_unavailable/);

    await db.query(`delete from therapist_services where therapist_id = $1 and service_id = $2`, [therapistB, swedish]);
    await expect(hold(therapistB, nextSlot())).rejects.toThrow(/therapist_unavailable/);
    await db.query(`insert into therapist_services (therapist_id, service_id) values ($1, $2)`, [therapistB, swedish]);
  });

  it('can only be called by server-side code', async () => {
    const call = () => db.query(`select * from create_booking_hold($1, $2, $3)`, [swedish, therapistA, nextSlot().toISOString()]);
    await expect(asRole(db, 'anon', null, call)).rejects.toThrow(/permission denied/);
    await expect(asRole(db, 'authenticated', null, call)).rejects.toThrow(/permission denied/);
  });
});

describe('overlapping booking prevention', () => {
  it('refuses a second hold on the same slot', async () => {
    const start = nextSlot();
    await hold(therapistA, start);
    await expect(hold(therapistA, start)).rejects.toThrow(/slot_unavailable/);
  });

  it('refuses partial overlaps and starts inside the buffer, but allows the next free slot', async () => {
    const start = nextSlot();
    await hold(therapistA, start);
    await expect(hold(therapistA, plus(start, 30))).rejects.toThrow(/slot_unavailable/);
    await expect(hold(therapistA, plus(start, -30))).rejects.toThrow(/slot_unavailable/);
    await expect(hold(therapistA, plus(start, 60))).rejects.toThrow(/slot_unavailable/); // inside buffer
    await expect(hold(therapistA, plus(start, 75))).resolves.toMatchObject({ status: 'active' });
  });

  it('lets a different therapist take the same time', async () => {
    const start = nextSlot();
    await hold(therapistA, start);
    await expect(hold(therapistB, start)).resolves.toMatchObject({ status: 'active' });
  });

  it('refuses a hold over an existing appointment', async () => {
    const start = nextSlot();
    await appointment(therapistA, start);
    await expect(hold(therapistA, start)).rejects.toThrow(/slot_unavailable/);
    await expect(hold(therapistA, plus(start, 45))).rejects.toThrow(/slot_unavailable/);
  });

  it('refuses two appointments on the same slot', async () => {
    const start = nextSlot();
    await appointment(therapistA, start);
    await expect(appointment(therapistA, plus(start, 30))).rejects.toThrow(/appointments_no_overlap/);
  });

  it('refuses an appointment over another customer\'s hold, but accepts the hold owner', async () => {
    const start = nextSlot();
    const h = await hold(therapistA, start);
    await expect(appointment(therapistA, start)).rejects.toThrow(/slot_unavailable/);
    const a = await appointment(therapistA, start, { holdId: h.id });
    expect(a.hold_id).toBe(h.id);
  });

  it('frees the slot when an appointment is cancelled', async () => {
    const start = nextSlot();
    const a = await appointment(therapistA, start);
    await db.query(`update appointments set status = 'cancelled', cancelled_at = now() where id = $1`, [a.id]);
    await expect(hold(therapistA, start)).resolves.toMatchObject({ status: 'active' });
  });

  it('cannot move an appointment onto a taken slot', async () => {
    const start = nextSlot();
    await appointment(therapistA, start);
    const other = await appointment(therapistA, plus(start, 180));
    await expect(
      db.query(`update appointments set starts_at = $2, ends_at = $3, blocked_until = $4 where id = $1`, [
        other.id, start.toISOString(), plus(start, 60).toISOString(), plus(start, 75).toISOString(),
      ]),
    ).rejects.toThrow(/appointments_no_overlap/);
  });
});

describe('expired booking holds', () => {
  const expire = (id: string) => db.query(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [id]);

  it('stop blocking new holds as soon as they expire, without waiting for a sweep', async () => {
    const start = nextSlot();
    const first = await hold(therapistA, start);
    await expire(first.id);
    const second = await hold(therapistA, start);
    expect(second.status).toBe('active');
    expect((await one(db, `select status from booking_holds where id = $1`, [first.id])).status).toBe('expired');
  });

  it('stop blocking appointments', async () => {
    const start = nextSlot();
    const h = await hold(therapistA, start);
    await expire(h.id);
    await expect(appointment(therapistA, start)).resolves.toMatchObject({ status: 'confirmed' });
  });

  it('cannot be revived once the slot has been taken', async () => {
    const start = nextSlot();
    const first = await hold(therapistA, start);
    await expire(first.id);
    await hold(therapistA, start);
    await expect(
      db.query(`update booking_holds set status = 'active', expires_at = now() + interval '10 minutes' where id = $1`, [first.id]),
    ).rejects.toThrow(/booking_holds_no_overlap/);
  });

  it('are released by the sweep function', async () => {
    const a = await hold(therapistA, nextSlot());
    const b = await hold(therapistB, nextSlot());
    const live = await hold(therapistA, nextSlot());
    await expire(a.id);
    await expire(b.id);
    const { released } = await asRole(db, 'service_role', null, () =>
      one(db, `select release_expired_booking_holds() as released`),
    );
    expect(released).toBe(2);
    const statuses = await rows(db, `select id, status from booking_holds where id = any($1::uuid[])`, [[a.id, b.id, live.id]]);
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({
      [a.id]: 'expired', [b.id]: 'expired', [live.id]: 'active',
    });
  });
});
