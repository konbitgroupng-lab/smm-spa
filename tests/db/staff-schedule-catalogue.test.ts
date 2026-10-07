import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createStaff, createTestDb, one, rows } from './harness';
import { at, upcoming, FRI, MON, SAT, THU, TUE, WED } from './dates';

// Phase 5c: schedule and catalogue changes. Existing bookings are never
// changed or cancelled by them: conflicts are surfaced, and a change that
// creates new ones needs explicit confirmation with a reason.

let db: PGlite;
const id: Record<string, string> = {};
let swedish: string;
let facial: string;
let therapistA: string;
let therapistB: string;
let therapistC: string;
let mainland: string;

type Actor = 'anon' | 'newAccount' | 'inactiveAdmin' | 'therapist' | 'admin' | 'owner';
const ACTORS: Actor[] = ['anon', 'newAccount', 'inactiveAdmin', 'therapist', 'admin', 'owner'];

async function as<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  return actor === 'anon' ? asRole(db, 'anon', null, fn) : asRole(db, 'authenticated', id[actor], fn);
}
async function attempt(actor: Actor, sql: string, params: unknown[] = []): Promise<{ ok: boolean; error?: string; detail?: any; row?: any }> {
  try {
    const result = await as(actor, () => db.query<any>(sql, params));
    return { ok: true, row: result.rows[0] };
  } catch (err: any) {
    const error = /permission denied/.test(err.message) ? 'denied' : err.message;
    let detail = err.detail;
    try { detail = JSON.parse(err.detail); } catch { /* plain text */ }
    return { ok: false, error, detail };
  }
}
const outcome = async (actor: Actor, sql: string, params: unknown[] = []) => {
  const r = await attempt(actor, sql, params);
  return r.ok ? 'ok' : r.error!;
};

const overview = async () => (await as('admin', () => one(db, `select staff_schedule_overview() as o`))).o;
const catalogue = async () => (await as('admin', () => one(db, `select staff_catalogue() as c`))).c;
const conflictsOf = async (apptId: string) =>
  (await as('admin', () => rows(db, `select reasons from staff_schedule_conflicts() where appointment_id = $1`, [apptId])))[0]?.reasons ?? [];
const appt = (apptId: string) => one(db, `select * from appointments where id = $1`, [apptId]);
const serviceRow = (serviceId: string) => one(db, `select *, updated_at::text as v from services where id = $1`, [serviceId]);
const fieldsOf = (s: any, changes: Record<string, unknown> = {}) => JSON.stringify({
  slug: s.slug, name: s.name, category: s.category, description: s.description, benefits: s.benefits,
  duration_minutes: s.duration_minutes, buffer_minutes: s.buffer_minutes, price_minor: Number(s.price_minor),
  compare_at_price_minor: s.compare_at_price_minor === null ? null : Number(s.compare_at_price_minor),
  is_popular: s.is_popular, is_active: s.is_active, sort_order: s.sort_order, is_package: s.is_package, ...changes,
});

/** A phone booking (made through the 5b function, so it passes every rule). */
async function booking(start: Date, therapist: string, extra: { service?: string; mobile?: boolean } = {}) {
  return as('admin', () => one(db, `select * from staff_create_booking(p_source => 'phone', p_settlement => 'pay_at_venue',
      p_service_id => $1, p_starts_at => $2, p_reason => 'Booked by phone', p_therapist_id => $3,
      p_location_type => $4, p_dispatch_zone_id => $5, p_service_address => $6,
      p_customer_name => 'Schedule Guest', p_customer_phone => '+2348036660000')`,
    [extra.service ?? swedish, start.toISOString(), therapist, extra.mobile ? 'mobile' : 'sanctuary',
      extra.mobile ? mainland : null, extra.mobile ? '3 Bode Thomas Street' : null]));
}

const SHIFTS_MON_SAT = (from = '09:00', to = '20:00') => [1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_time: from, end_time: to }));
const BREAKS_MON_SAT = [1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_time: '13:00', end_time: '14:00' }));

beforeAll(async () => {
  db = await createTestDb();
  id.owner = await createStaff(db, 'owner@example.com', 'owner');
  id.admin = await createStaff(db, 'admin@example.com', 'admin');
  id.therapist = await createStaff(db, 'therapist@example.com', 'therapist');
  id.inactiveAdmin = await createStaff(db, 'inactive@example.com', 'admin', { active: false });
  id.newAccount = (await one(db, `insert into auth.users (email) values ('new@example.com') returning id`)).id;
  therapistA = (await one(db, `update therapists set profile_id = $1 where sort_order = 1 returning id`, [id.therapist])).id;
  therapistB = (await one(db, `select id from therapists where sort_order = 2`)).id;
  therapistC = (await one(db, `select id from therapists where sort_order = 3`)).id;
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  facial = (await one(db, `select id from services where slug = 'facial-treatment'`)).id;
  mainland = (await one(db, `select id from dispatch_zones where key = 'mainland'`)).id;
});

// ---------------------------------------------------------------------------
describe('who may call each function', () => {
  it('reads and changes: owner/admin only', async () => {
    const o = await overview();
    const c = await catalogue();
    const swedishRow = c.services.find((s: any) => s.id === swedish);
    const therapist = c.therapists.find((t: any) => t.id === therapistB);
    const zone = c.zones.find((z: any) => z.id === mainland);
    const pkg = c.services.find((s: any) => s.is_package);
    const calls: [string, unknown[]][] = [
      [`select staff_schedule_overview()`, []],
      [`select staff_catalogue()`, []],
      [`select * from staff_schedule_conflicts()`, []],
      [`select staff_set_business_hours($1, $2)`, [JSON.stringify(o.hours), o.hours_version]],
      [`select staff_set_therapist_week($1, $2, $3, $4)`, [therapistB, JSON.stringify(SHIFTS_MON_SAT()), JSON.stringify(BREAKS_MON_SAT),
        o.therapists.find((t: any) => t.id === therapistB).week_version]],
      [`select staff_add_time_off($1, now() + interval '58 days', now() + interval '59 days', 'Leave')`, [therapistB]],
      [`select staff_add_blackout(now() + interval '58 days', now() + interval '59 days', 'Holiday')`, []],
      [`select staff_save_service($1, $2, $3)`, [swedish, swedishRow.updated_at, fieldsOf({ ...swedishRow, benefits: swedishRow.benefits })]],
      [`select staff_set_package_items($1, $2, $3)`, [pkg.id, pkg.items.map((i: any) => i.service_id), pkg.items_version]],
      [`select staff_save_therapist($1, $2, $3)`, [therapistB, therapist.updated_at, JSON.stringify({ display_name: therapist.display_name, title: therapist.title, specialty: therapist.specialty, bio: therapist.bio, is_active: true, sort_order: therapist.sort_order })]],
      [`select staff_set_therapist_services($1, $2, $3)`, [therapistB, therapist.service_ids, therapist.services_version]],
      [`select staff_save_zone($1, $2, $3)`, [mainland, zone.updated_at, JSON.stringify({ key: zone.key, name: zone.name, fee_minor: Number(zone.fee_minor), is_active: true, sort_order: zone.sort_order })]],
    ];
    for (const [sql, params] of calls) {
      for (const actor of ACTORS) {
        if (actor === 'owner' || actor === 'admin') continue;
        expect(await outcome(actor, sql, params), `${sql} as ${actor}`).toBe(actor === 'anon' ? 'denied' : 'not_authorized');
      }
      expect(await outcome('owner', sql, params), sql).toBe('ok'); // unchanged versions: each call succeeds
    }
  });

  it('nobody writes the schedule or catalogue tables directly', async () => {
    for (const actor of ['owner', 'admin', 'therapist'] as Actor[]) {
      for (const sql of [
        `update business_hours set is_closed = true`, `delete from therapist_schedules`, `delete from therapist_breaks`,
        `insert into therapist_time_off (therapist_id, starts_at, ends_at) select id, now(), now() + interval '1 day' from therapists limit 1`,
        `delete from blackout_dates`, `update services set price_minor = 1`, `delete from service_package_items`,
        `delete from therapist_services`, `update dispatch_zones set fee_minor = 0`, `update therapists set is_active = false`,
        `insert into services (slug, name, duration_minutes, price_minor) values ('x', 'X', 60, 1)`,
      ]) {
        expect(await outcome(actor, sql), `${sql} as ${actor}`).toBe('denied');
      }
    }
  });

  it('allow_demo_payments stays out of reach', async () => {
    const fns = await rows(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (pg_get_function_arguments(p.oid) ilike '%demo%' or p.prosrc ilike '%allow_demo_payments%')
        and p.proname like 'staff_%'`);
    expect(fns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('opening hours', () => {
  it('closing a day with bookings needs confirmation; the bookings stay and are listed', async () => {
    const day = upcoming(WED, 2);
    const kept = await booking(at(day, '10:00'), therapistB);
    const before = await appt(kept.id);
    const o = await overview();
    const closedWed = o.hours.map((h: any) => (h.day_of_week === 3 ? { ...h, is_closed: true, opens_at: null, closes_at: null } : h));

    const refused = await attempt('admin', `select staff_set_business_hours($1, $2)`, [JSON.stringify(closedWed), o.hours_version]);
    expect(refused).toMatchObject({ ok: false, error: 'confirmation_required' });
    expect(refused.detail.appointments.find((a: any) => a.id === kept.id)).toMatchObject({
      reference: kept.reference, reasons: ['outside_business_hours'], contact_name: 'Schedule Guest',
    });
    expect((await overview()).hours_version).toBe(o.hours_version); // nothing applied

    expect(await outcome('admin', `select staff_set_business_hours($1, $2, null, true)`, [JSON.stringify(closedWed), o.hours_version])).toBe('reason_required');
    const done = await attempt('admin', `select staff_set_business_hours($1, $2, 'Closed on Wednesdays from now on', true) as r`,
      [JSON.stringify(closedWed), o.hours_version]);
    expect(done.ok).toBe(true);
    expect(done.row.r.conflicts.appointments.map((a: any) => a.id)).toContain(kept.id);

    expect(await appt(kept.id)).toEqual(before); // untouched
    expect(await conflictsOf(kept.id)).toEqual(['outside_business_hours']);
    // Guests can no longer book that day.
    expect(await asRole(db, 'anon', null, () => rows(db, `select * from get_available_slots($1, $2)`, [swedish, day]))).toEqual([]);
    // The acceptance is audited with ids and reasons, never names.
    const note = await one(db, `select * from audit_log where action = 'schedule.conflicts_accepted' order by id desc limit 1`);
    expect(note).toMatchObject({ actor_id: id.admin, entity_type: 'business_hours', reason: 'Closed on Wednesdays from now on' });
    expect(note.context.appointments).toContainEqual({ id: kept.id, reasons: ['outside_business_hours'] });
    expect(JSON.stringify(note)).not.toContain('Schedule Guest');
    expect(await one(db, `select action, reason from audit_log where entity_type = 'business_hours' and entity_id = '3' order by id desc limit 1`))
      .toMatchObject({ action: 'schedule.hours_changed' });

    // Reopening clears the conflict without any confirmation.
    const now = await overview();
    const reopened = now.hours.map((h: any) => (h.day_of_week === 3 ? { ...h, is_closed: false, opens_at: '09:00', closes_at: '21:00' } : h));
    expect(await outcome('admin', `select staff_set_business_hours($1, $2)`, [JSON.stringify(reopened), now.hours_version])).toBe('ok');
    expect(await conflictsOf(kept.id)).toEqual([]);
  });

  it('refuses stale versions and invalid weeks', async () => {
    const o = await overview();
    expect(await outcome('admin', `select staff_set_business_hours($1, 'old')`, [JSON.stringify(o.hours)])).toBe('stale_record');
    const bad = o.hours.map((h: any) => (h.day_of_week === 1 ? { ...h, opens_at: '18:00', closes_at: '09:00' } : h));
    expect(await outcome('admin', `select staff_set_business_hours($1, $2)`, [JSON.stringify(bad), o.hours_version])).toBe('invalid_schedule');
    expect(await outcome('admin', `select staff_set_business_hours($1, $2)`, [JSON.stringify(o.hours.slice(1)), o.hours_version])).toBe('invalid_schedule');
  });
});

// ---------------------------------------------------------------------------
describe('therapist weeks, time off and blackouts', () => {
  it('a shift change that leaves a booking outside the shift is confirmed, never applied to the booking', async () => {
    const kept = await booking(at(upcoming(THU, 2), '17:00'), therapistC);
    const before = await appt(kept.id);
    const week = (await overview()).therapists.find((t: any) => t.id === therapistC);
    const shorter = SHIFTS_MON_SAT('09:00', '16:00');
    const refused = await attempt('admin', `select staff_set_therapist_week($1, $2, $3, $4)`,
      [therapistC, JSON.stringify(shorter), JSON.stringify(BREAKS_MON_SAT), week.week_version]);
    expect(refused.error).toBe('confirmation_required');
    expect(refused.detail.appointments.map((a: any) => a.id)).toContain(kept.id);
    expect(await outcome('admin', `select staff_set_therapist_week($1, $2, $3, $4, 'Shorter days in December', true)`,
      [therapistC, JSON.stringify(shorter), JSON.stringify(BREAKS_MON_SAT), week.week_version])).toBe('ok');
    expect(await appt(kept.id)).toEqual(before);
    expect(await conflictsOf(kept.id)).toEqual(['outside_shift']);
    // Only the rows that changed were rewritten (and audited).
    expect(Number((await one(db, `select count(*) from audit_log where action = 'schedule.therapist_week_changed' and entity_type = 'therapist_breaks'`)).count)).toBe(0);
    // Two edits from the same version: the second is stale.
    expect(await outcome('admin', `select staff_set_therapist_week($1, $2, $3, $4)`,
      [therapistC, JSON.stringify(SHIFTS_MON_SAT()), JSON.stringify(BREAKS_MON_SAT), week.week_version])).toBe('stale_record');
    const now = (await overview()).therapists.find((t: any) => t.id === therapistC);
    await as('admin', () => db.query(`select staff_set_therapist_week($1, $2, $3, $4)`,
      [therapistC, JSON.stringify(SHIFTS_MON_SAT()), JSON.stringify(BREAKS_MON_SAT), now.week_version]));
    expect(await conflictsOf(kept.id)).toEqual([]);
  });

  it('overlapping shifts or breaks are refused', async () => {
    const week = (await overview()).therapists.find((t: any) => t.id === therapistC);
    const overlapping = [...SHIFTS_MON_SAT(), { day_of_week: 1, start_time: '19:00', end_time: '21:00' }];
    expect(await outcome('admin', `select staff_set_therapist_week($1, $2, $3, $4)`,
      [therapistC, JSON.stringify(overlapping), JSON.stringify(BREAKS_MON_SAT), week.week_version])).toBe('invalid_schedule');
    expect(await outcome('admin', `select staff_set_therapist_week($1, $2, '[{"day_of_week": 9, "start_time": "10:00", "end_time": "11:00"}]', $3)`,
      [therapistC, JSON.stringify(SHIFTS_MON_SAT()), week.week_version])).toBe('invalid_schedule');
  });

  it('time off over a booking: confirmed, the booking kept and listed; removing it clears the conflict', async () => {
    const day = upcoming(FRI, 2);
    const kept = await booking(at(day, '10:30'), therapistA);
    const before = await appt(kept.id);
    const refused = await attempt('admin', `select staff_add_time_off($1, $2, $3, 'Hospital appointment')`,
      [therapistA, at(day, '09:00').toISOString(), at(day, '14:00').toISOString()]);
    expect(refused).toMatchObject({ error: 'confirmation_required' });
    const added = await attempt('admin', `select staff_add_time_off($1, $2, $3, 'Hospital appointment', 'Agreed with the therapist', true) as r`,
      [therapistA, at(day, '09:00').toISOString(), at(day, '14:00').toISOString()]);
    expect(await appt(kept.id)).toEqual(before);
    expect(await conflictsOf(kept.id)).toEqual(['time_off']);
    // The therapist's own agenda still shows it.
    expect((await as('therapist', () => rows(db, `select appointment_id from therapist_agenda(now(), now() + interval '60 days')`))).map((r) => r.appointment_id)).toContain(kept.id);
    // The note may be about health: logged as changed only.
    expect(JSON.stringify(await rows(db, `select * from audit_log where entity_type = 'therapist_time_off'`))).not.toContain('Hospital');
    await as('admin', () => db.query(`select staff_remove_time_off($1, 'Plans changed')`, [added.row.r.id]));
    expect(await conflictsOf(kept.id)).toEqual([]);
    expect(await outcome('admin', `select staff_remove_time_off($1)`, [added.row.r.id])).toBe('not_found');
    expect(await outcome('admin', `select staff_add_time_off($1, now() + interval '2 days', now() + interval '1 day')`, [therapistA])).toBe('invalid_period');
  });

  it('a blackout over a booking: confirmed, the booking kept and listed', async () => {
    const day = upcoming(SAT, 2);
    const kept = await booking(at(day, '15:30'), therapistB);
    const before = await appt(kept.id);
    expect((await attempt('admin', `select staff_add_blackout($1, $2, 'Generator repair')`, [at(day, '00:00').toISOString(), at(day, '23:59').toISOString()])).error)
      .toBe('confirmation_required');
    const added = await attempt('owner', `select staff_add_blackout($1, $2, 'Generator repair', 'Power works all day', true) as r`,
      [at(day, '00:00').toISOString(), at(day, '23:59').toISOString()]);
    expect(await appt(kept.id)).toEqual(before);
    expect(await conflictsOf(kept.id)).toEqual(['blackout']);
    expect((await overview()).blackouts.map((b: any) => b.note)).toContain('Generator repair');
    await as('admin', () => db.query(`select staff_remove_blackout($1)`, [added.row.r.id]));
    expect(await conflictsOf(kept.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('services and packages', () => {
  it('a price change never touches bookings or payments already started', async () => {
    const kept = await booking(at(upcoming(MON, 3), '10:30'), therapistB);
    const hold = await asRole(db, 'service_role', null, () => one(db, `select * from request_booking_hold($1, $2, $3)`,
      [swedish, at(upcoming(MON, 3), '15:30').toISOString(), therapistB]));
    await db.query(`select attach_customer_to_hold($1, 'Paying Guest', 'paying@example.com', '+2348036660001')`, [hold.hold_token]);
    const pay = (await one(db, `select begin_hold_payment($1, 'mock', true) as p`, [hold.hold_token])).p;
    const s = await serviceRow(swedish);
    expect(await outcome('admin', `select staff_save_service($1, $2, $3)`, [swedish, s.v, fieldsOf(s, { price_minor: 5000000 })])).toBe('ok');
    expect(Number((await appt(kept.id)).price_minor)).toBe(4000000);
    expect(Number((await one(db, `select amount_minor from payments where provider_reference = $1`, [pay.reference])).amount_minor)).toBe(4000000);
    await db.query(`select record_payment_result('mock', $1, 'success', 4000000, 'NGN')`, [pay.reference]);
    const paid = await one(db, `select a.price_minor, p.needs_refund from payments p join appointments a on a.id = p.appointment_id where p.provider_reference = $1`, [pay.reference]);
    expect(paid).toMatchObject({ needs_refund: false });
    expect(Number(paid.price_minor)).toBe(4000000);
    const back = await serviceRow(swedish);
    await as('admin', () => db.query(`select staff_save_service($1, $2, $3)`, [swedish, back.v, fieldsOf(back, { price_minor: 4000000 })]));
  });

  it('a duration change keeps existing bookings as they are; a guest mid-payment is warned about and flagged at payment', async () => {
    const kept = await booking(at(upcoming(TUE, 3), '10:30'), therapistB);
    const before = await appt(kept.id);
    const hold = await asRole(db, 'service_role', null, () => one(db, `select * from request_booking_hold($1, $2, $3)`,
      [swedish, at(upcoming(TUE, 3), '15:30').toISOString(), therapistB]));
    await db.query(`select attach_customer_to_hold($1, 'Paying Guest', 'paying2@example.com', '+2348036660002')`, [hold.hold_token]);
    const pay = (await one(db, `select begin_hold_payment($1, 'mock', true) as p`, [hold.hold_token])).p;
    const s = await serviceRow(swedish);
    const refused = await attempt('admin', `select staff_save_service($1, $2, $3)`, [swedish, s.v, fieldsOf(s, { duration_minutes: 90 })]);
    expect(refused).toMatchObject({ error: 'confirmation_required', detail: { appointments: [], reservations: 1 } });
    expect(await outcome('admin', `select staff_save_service($1, $2, $3, 'Longer Swedish sessions', true)`, [swedish, s.v, fieldsOf(s, { duration_minutes: 90 })])).toBe('ok');
    expect(await appt(kept.id)).toEqual(before); // still 60 minutes
    expect(await conflictsOf(kept.id)).toEqual([]);
    const result = (await one(db, `select record_payment_result('mock', $1, 'success', 4000000, 'NGN') as r`, [pay.reference])).r;
    expect(result.status).toBe('refund_required');
    expect(await one(db, `select needs_refund_reason, needs_refund_detail from payments where provider_reference = $1`, [pay.reference]))
      .toEqual({ needs_refund_reason: 'service_changed', needs_refund_detail: 'duration' });
    const back = await serviceRow(swedish);
    await as('admin', () => db.query(`select staff_save_service($1, $2, $3)`, [swedish, back.v, fieldsOf(back, { duration_minutes: 60 })]));
  });

  it('deactivating a service with future bookings: confirmed, bookings kept and listed, never deleted', async () => {
    const kept = await booking(at(upcoming(WED, 3), '10:30'), therapistB, { service: facial });
    const s = await serviceRow(facial);
    expect((await attempt('admin', `select staff_save_service($1, $2, $3)`, [facial, s.v, fieldsOf(s, { is_active: false })])).error).toBe('confirmation_required');
    expect(await outcome('admin', `select staff_save_service($1, $2, $3, 'Facial room closed', true)`, [facial, s.v, fieldsOf(s, { is_active: false })])).toBe('ok');
    expect(await appt(kept.id)).toMatchObject({ status: 'confirmed', service_id: facial });
    expect(await conflictsOf(kept.id)).toEqual(['service_inactive']);
    expect((await catalogue()).services.find((x: any) => x.id === facial)).toMatchObject({ is_active: false, future_appointments: 1 });
    expect(await asRole(db, 'anon', null, () => rows(db, `select id from services where id = $1`, [facial]))).toEqual([]); // off the website
    const back = await serviceRow(facial);
    await as('admin', () => db.query(`select staff_save_service($1, $2, $3)`, [facial, back.v, fieldsOf(back, { is_active: true })]));
    expect(await conflictsOf(kept.id)).toEqual([]);
  });

  it('creates services and packages; validates; package contents are versioned', async () => {
    const created = (await as('owner', () => one(db, `select staff_save_service(null, null, $1) as r`, [JSON.stringify({
      slug: 'couples-massage', name: 'Couples Massage', category: 'Relaxation', description: 'Side by side.', benefits: ['Shared calm'],
      duration_minutes: 90, buffer_minutes: 20, price_minor: 9000000, compare_at_price_minor: null, is_popular: false, is_active: true, sort_order: 7,
    })]))).r;
    expect(await one(db, `select slug, is_package, currency from services where id = $1`, [created.id])).toEqual({ slug: 'couples-massage', is_package: false, currency: 'NGN' });
    expect(await outcome('admin', `select staff_save_service(null, null, $1)`, [JSON.stringify({ slug: 'couples-massage', name: 'Dup', duration_minutes: 60, price_minor: 1 })])).toBe('slug_in_use');
    for (const bad of [{ slug: 'Bad Slug', name: 'Ok name', duration_minutes: 60, price_minor: 1 }, { slug: 'ok', name: 'Ok name', duration_minutes: 2, price_minor: 1 },
      { slug: 'ok', name: 'Ok name', duration_minutes: 60, price_minor: -1 }, { slug: 'ok', name: 'Ok name', duration_minutes: 'sixty', price_minor: 1 },
      { slug: 'ok', name: 'Ok name', duration_minutes: 60, price_minor: 100, compare_at_price_minor: 50 }]) {
      expect(await outcome('admin', `select staff_save_service(null, null, $1)`, [JSON.stringify(bad)]), JSON.stringify(bad)).toBe('invalid_service');
    }
    const pkg = (await catalogue()).services.find((s: any) => s.slug === 'pkg-essential');
    const facialPkg = [swedish, facial];
    expect(await outcome('admin', `select staff_set_package_items($1, $2, $3)`, [pkg.id, facialPkg, 'old'])).toBe('stale_record');
    expect(await outcome('admin', `select staff_set_package_items($1, $2, $3)`, [pkg.id, [pkg.id], pkg.items_version])).toBe('invalid_package');
    const other = (await catalogue()).services.find((s: any) => s.slug === 'pkg-signature');
    expect(await outcome('admin', `select staff_set_package_items($1, $2, $3)`, [pkg.id, [other.id], pkg.items_version])).toBe('invalid_package');
    expect(await outcome('admin', `select staff_set_package_items($1, $2, $3, 'Facial instead of hot stone')`, [pkg.id, facialPkg, pkg.items_version])).toBe('ok');
    expect((await catalogue()).services.find((s: any) => s.id === pkg.id).items.map((i: any) => i.service_id)).toEqual(facialPkg);
    expect(await one(db, `select action, reason from audit_log where entity_type = 'service_package_items' order by id desc limit 1`))
      .toEqual({ action: 'catalogue.package_items_changed', reason: 'Facial instead of hot stone' });
    // is_package cannot be changed after creation.
    const s = await serviceRow(swedish);
    await as('admin', () => db.query(`select staff_save_service($1, $2, $3)`, [swedish, s.v, fieldsOf(s, { is_package: true })]));
    expect((await serviceRow(swedish)).is_package).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('therapists and their services', () => {
  it('deactivating a therapist with future bookings: confirmed, bookings kept and listed', async () => {
    const kept = await booking(at(upcoming(THU, 3), '10:30'), therapistC);
    const t = (await catalogue()).therapists.find((x: any) => x.id === therapistC);
    const fields = (active: boolean) => JSON.stringify({ display_name: t.display_name, title: t.title, specialty: t.specialty, bio: t.bio, is_active: active, sort_order: t.sort_order });
    expect((await attempt('admin', `select staff_save_therapist($1, $2, $3)`, [therapistC, t.updated_at, fields(false)])).error).toBe('confirmation_required');
    expect(await outcome('admin', `select staff_save_therapist($1, $2, $3, 'Left the business', true)`, [therapistC, t.updated_at, fields(false)])).toBe('ok');
    expect(await appt(kept.id)).toMatchObject({ status: 'confirmed', therapist_id: therapistC });
    expect(await conflictsOf(kept.id)).toEqual(['therapist_inactive']);
    // No new bookings for an inactive therapist, by guests or staff.
    expect(await outcome('admin', `select * from staff_create_booking(p_source => 'phone', p_settlement => 'pay_at_venue', p_service_id => $1, p_starts_at => $2,
      p_reason => 'x reason', p_therapist_id => $3, p_customer_name => 'Someone', p_customer_phone => '+2348036660009')`,
      [swedish, at(upcoming(THU, 3), '15:30').toISOString(), therapistC])).toBe('therapist_unavailable');
    const now = (await catalogue()).therapists.find((x: any) => x.id === therapistC);
    await as('admin', () => db.query(`select staff_save_therapist($1, $2, $3)`, [therapistC, now.updated_at, fields(true)]));
    expect(await conflictsOf(kept.id)).toEqual([]);
  });

  it('removing a service a therapist has bookings for: confirmed and listed', async () => {
    const kept = await booking(at(upcoming(FRI, 3), '10:30'), therapistC);
    const t = (await catalogue()).therapists.find((x: any) => x.id === therapistC);
    const without = t.service_ids.filter((s: string) => s !== swedish);
    expect((await attempt('admin', `select staff_set_therapist_services($1, $2, $3)`, [therapistC, without, t.services_version])).error).toBe('confirmation_required');
    expect(await outcome('admin', `select staff_set_therapist_services($1, $2, $3, 'No longer does Swedish', true)`, [therapistC, without, t.services_version])).toBe('ok');
    expect(await conflictsOf(kept.id)).toEqual(['therapist_service_removed']);
    expect(await outcome('admin', `select staff_set_therapist_services($1, $2, $3)`, [therapistC, t.service_ids, t.services_version])).toBe('stale_record');
    const now = (await catalogue()).therapists.find((x: any) => x.id === therapistC);
    await as('admin', () => db.query(`select staff_set_therapist_services($1, $2, $3)`, [therapistC, t.service_ids, now.services_version]));
    expect(await conflictsOf(kept.id)).toEqual([]);
  });

  it('creates a therapist with no services and no shifts (so not yet bookable)', async () => {
    const created = (await as('admin', () => one(db, `select staff_save_therapist(null, null, $1) as r`,
      [JSON.stringify({ display_name: 'New Therapist', title: 'Massage', specialty: '', bio: '', is_active: true, sort_order: 9 })]))).r;
    const t = (await catalogue()).therapists.find((x: any) => x.id === created.id);
    expect(t).toMatchObject({ service_ids: [], has_account: false, future_appointments: 0 });
    expect(await asRole(db, 'anon', null, () => rows(db, `select * from get_available_slots($1, $2, $3)`, [swedish, upcoming(MON, 1), created.id]))).toEqual([]);
    expect(await outcome('admin', `select staff_save_therapist(null, null, '{"display_name": "X"}')`)).toBe('invalid_therapist');
  });
});

// ---------------------------------------------------------------------------
describe('in-home areas', () => {
  it('a fee change keeps booked fees; deactivation keeps in-home bookings and lists them', async () => {
    const kept = await booking(at(upcoming(SAT, 3), '10:30'), therapistB, { mobile: true });
    expect(Number(kept.dispatch_fee_minor)).toBe(300000);
    const z = (await catalogue()).zones.find((x: any) => x.id === mainland);
    const fields = (fee: number, active: boolean) => JSON.stringify({ key: z.key, name: z.name, fee_minor: fee, is_active: active, sort_order: z.sort_order });
    expect(await outcome('admin', `select staff_save_zone($1, $2, $3)`, [mainland, z.updated_at, fields(450000, true)])).toBe('ok');
    expect(Number((await appt(kept.id)).dispatch_fee_minor)).toBe(300000);
    const z2 = (await catalogue()).zones.find((x: any) => x.id === mainland);
    expect((await attempt('admin', `select staff_save_zone($1, $2, $3)`, [mainland, z2.updated_at, fields(450000, false)])).error).toBe('confirmation_required');
    expect(await outcome('admin', `select staff_save_zone($1, $2, $3, 'No longer serving this area', true)`, [mainland, z2.updated_at, fields(450000, false)])).toBe('ok');
    expect(await appt(kept.id)).toMatchObject({ status: 'confirmed', dispatch_zone_id: mainland });
    expect(await conflictsOf(kept.id)).toEqual(['zone_inactive']);
    const z3 = (await catalogue()).zones.find((x: any) => x.id === mainland);
    await as('admin', () => db.query(`select staff_save_zone($1, $2, $3)`, [mainland, z3.updated_at, fields(300000, true)]));
    expect(await conflictsOf(kept.id)).toEqual([]);
    expect(await outcome('admin', `select staff_save_zone(null, null, $1)`, [JSON.stringify({ key: 'mainland', name: 'Duplicate', fee_minor: 0 })])).toBe('key_in_use');
    expect(await outcome('admin', `select staff_save_zone(null, null, $1)`, [JSON.stringify({ key: 'ikorodu', name: 'Ikorodu', fee_minor: 1500000 })])).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
describe('invariants', () => {
  it('no schedule or catalogue function ever cancelled, moved or deleted a booking, or created an overlap', async () => {
    const cancelled = await rows(db, `select id from appointments where status = 'cancelled'`);
    expect(cancelled).toEqual([]);
    const actions = await rows(db, `select distinct action from audit_log where entity_type = 'appointments' and action not in ('appointment.created_by_staff', 'insert')`);
    expect(actions).toEqual([]);
    const overlaps = await one(db, `select count(*)::int as n from appointments a join appointments b
      on a.therapist_id = b.therapist_id and a.id < b.id and a.status in ('confirmed','completed','pending_payment') and b.status in ('confirmed','completed','pending_payment')
      and tstzrange(a.starts_at, a.blocked_until) && tstzrange(b.starts_at, b.blocked_until)`);
    expect(overlaps.n).toBe(0);
  });

  it('every schedule and catalogue action is audited with its name', async () => {
    const actions = (await rows(db, `select distinct action from audit_log where action like 'schedule.%' or action like 'catalogue.%' order by 1`)).map((r) => r.action);
    expect(actions).toEqual([
      'catalogue.package_items_changed', 'catalogue.service_created', 'catalogue.service_updated', 'catalogue.therapist_created',
      'catalogue.therapist_services_changed', 'catalogue.therapist_updated', 'catalogue.zone_created', 'catalogue.zone_updated',
      'schedule.blackout_added', 'schedule.blackout_removed', 'schedule.conflicts_accepted', 'schedule.hours_changed',
      'schedule.therapist_week_changed', 'schedule.time_off_added', 'schedule.time_off_removed',
    ]);
    const unnamed = await rows(db, `select distinct entity_type from audit_log where actor_kind = 'staff' and action in ('insert', 'update', 'delete')
      and entity_type in ('business_hours', 'therapist_schedules', 'therapist_breaks', 'therapist_time_off', 'blackout_dates', 'services',
        'service_package_items', 'therapists', 'therapist_services', 'dispatch_zones')`);
    expect(unnamed).toEqual([]);
  });

  it('the dashboard and overview count conflicts', async () => {
    const o = await overview();
    expect(o).toHaveProperty('conflict_count');
    expect(o.rules).toMatchObject({ timezone: 'Africa/Lagos', hold_minutes: 10, min_lead_minutes: 120 });
    const dash = (await as('owner', () => one(db, `select staff_dashboard() as d`))).d;
    expect(dash.schedule_conflicts).toBe(o.conflict_count);
  });
});
