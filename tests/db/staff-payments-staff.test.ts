import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createStaff, createTestDb, one, rows } from './harness';
import { at, upcoming, MON, TUE, WED } from './dates';

// Phase 5d: payments (read-only), owner-only manual refund records, staff
// accounts, settings and the audit viewer. Enforced by the database.

let db: PGlite;
const id: Record<string, string> = {};
let swedish: string;
let therapistB: string;
let guests = 0;

type Actor = 'anon' | 'newAccount' | 'inactiveAdmin' | 'therapist' | 'admin' | 'owner';
const ACTORS: Actor[] = ['anon', 'newAccount', 'inactiveAdmin', 'therapist', 'admin', 'owner'];

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
const service = <T>(fn: () => Promise<T>) => asRole(db, 'service_role', null, fn);
const payment = (ref: string) => one(db, `select *, updated_at::text as v from payments where provider_reference = $1`, [ref]);

/** A guest's demo payment for a slot, completed (status succeeded, booking made). */
async function paid(start: Date, therapist = therapistB) {
  const n = ++guests;
  const hold = await service(() => one(db, `select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), therapist]));
  await service(() => db.query(`select attach_customer_to_hold($1, $2, $3, '+2348039990000')`, [hold.hold_token, `Paying Guest ${n}`, `payer${n}@example.com`]));
  const { p } = await service(() => one(db, `select begin_hold_payment($1, 'mock', true) as p`, [hold.hold_token]));
  await service(() => db.query(`select record_payment_result('mock', $1, 'success', $2, 'NGN')`, [p.reference, p.amount_minor]));
  return payment(p.reference);
}
const RECORD = `select owner_record_refund($1, $2, $3, $4, $5, $6, $7) as r`;

beforeAll(async () => {
  db = await createTestDb();
  id.owner = await createStaff(db, 'owner@example.com', 'owner');
  await db.query(`update profiles set full_name = 'Olu Owner' where id = $1`, [id.owner]);
  id.admin = await createStaff(db, 'admin@example.com', 'admin');
  id.therapist = await createStaff(db, 'therapist@example.com', 'therapist');
  id.inactiveAdmin = await createStaff(db, 'inactive@example.com', 'admin', { active: false });
  id.newAccount = (await one(db, `insert into auth.users (email) values ('new@example.com') returning id`)).id;
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  therapistB = (await one(db, `select id from therapists where sort_order = 2`)).id;
  await db.query(`update therapists set profile_id = $1 where sort_order = 1`, [id.therapist]);
});

// ---------------------------------------------------------------------------
describe('who may call each function', () => {
  it('reads for owner/admin, owner-only actions for the owner, nothing for anyone else', async () => {
    const p = await paid(at(upcoming(MON, 1), '10:30'));
    const manager = ['owner', 'admin'];
    const calls: [string, unknown[], string[]][] = [
      [`select * from staff_payments('all')`, [], manager],
      [`select staff_payment_detail($1)`, [p.id], manager],
      [`select * from staff_audit_log()`, [], manager],
      [`select staff_settings()`, [], manager],
      [`select owner_staff_list()`, [], ['owner']],
      [`select owner_record_invitation($1)`, [id.newAccount], ['owner']],
      [RECORD, [p.id, 1000, 'provider_dashboard', 'Goodwill gesture', p.v, null, null], ['owner']],
    ];
    for (const [sql, params, allowed] of calls) {
      for (const actor of ACTORS) {
        const expected = allowed.includes(actor) ? 'ok' : actor === 'anon' ? 'denied' : 'not_authorized';
        expect(await outcome(actor, sql, params), `${sql} as ${actor}`).toBe(expected);
      }
    }
  });

  it('owner-only controls stay owner-only', async () => {
    const admin = await one(db, `select updated_at::text as v from profiles where id = $1`, [id.admin]);
    const settings = await one(db, `select updated_at::text as v from business_settings`);
    expect(await outcome('admin', `select owner_set_staff_role($1, 'owner', 'promote me', $2)`, [id.admin, admin.v])).toBe('not_authorized');
    expect(await outcome('admin', `select owner_set_staff_active($1, true, 'activate them', $2)`, [id.newAccount, admin.v])).toBe('not_authorized');
    expect(await outcome('admin', `select owner_update_payment_settings($1, 'turn it off', false)`, [settings.v])).toBe('not_authorized');
    expect(await outcome('admin', `select owner_link_therapist((select id from therapists limit 1), null, 'unlink', now())`)).toBe('not_authorized');
  });

  it('nobody writes payments, provider events, refund records, profiles or settings directly', async () => {
    for (const actor of ['owner', 'admin', 'therapist'] as Actor[]) {
      for (const sql of [
        `update payments set refunded_minor = 0`, `delete from payments`,
        `insert into payments (provider, provider_reference, amount_minor, is_test) values ('mock', 'FORGED', 1, true)`,
        `update payment_events set processed_at = now()`, `insert into payment_events (provider, event_id, event_type, payload) values ('mock', 'x', 'x', '{}')`,
        `insert into refund_records (payment_id, amount_minor, currency, method, recorded_by) select id, 1, 'NGN', 'cash', auth.uid() from payments limit 1`,
        `update refund_records set amount_minor = 1`, `delete from refund_records`,
        `update profiles set role = 'owner'`, `update business_settings set allow_demo_payments = false`,
      ]) {
        expect(await outcome(actor, sql), `${sql} as ${actor}`).toBe('denied');
      }
    }
  });

  it('therapists see no payment or refund data, even through reads', async () => {
    for (const table of ['payments', 'refund_records', 'audit_log']) {
      expect(await as('therapist', () => rows(db, `select * from ${table}`)), table).toEqual([]);
    }
    // Provider events are not readable by any signed-in user at all.
    expect(await outcome('therapist', `select * from payment_events`)).toBe('denied');
    expect(await outcome('owner', `select * from payment_events`)).toBe('denied');
  });
});

// ---------------------------------------------------------------------------
describe('payment visibility', () => {
  it('the list filters by status and the refund queue shows flagged payments, oldest first', async () => {
    const ok = await paid(at(upcoming(MON, 1), '15:30'));
    // A payment whose slot was retaken: money received, no booking, flagged.
    const hold = await service(() => one(db, `select * from request_booking_hold($1, $2, $3)`, [swedish, at(upcoming(TUE, 1), '10:30').toISOString(), therapistB]));
    await service(() => db.query(`select attach_customer_to_hold($1, 'Late Payer', 'late@example.com', '+2348039990001')`, [hold.hold_token]));
    const { p } = await service(() => one(db, `select begin_hold_payment($1, 'mock', true) as p`, [hold.hold_token]));
    await db.query(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [hold.id]);
    await service(() => db.query(`select * from request_booking_hold($1, $2, $3)`, [swedish, at(upcoming(TUE, 1), '10:30').toISOString(), therapistB]));
    await service(() => db.query(`select record_payment_result('mock', $1, 'success', $2, 'NGN')`, [p.reference, p.amount_minor]));

    const list = async (filter: string) => as('admin', () => rows(db, `select * from staff_payments($1)`, [filter]));
    expect((await list('succeeded')).map((r) => r.payment_id)).toContain(ok.id);
    const queue = await list('refund_due');
    expect(queue.find((r) => r.reference === p.reference)).toMatchObject({
      needs_refund: true, needs_refund_reason: 'slot_retaken', is_demo: true, guest_name: 'Late Payer', appointment_id: null,
    });
    expect((await list('refund_due')).map((r) => r.payment_id)).not.toContain(ok.id);
    expect(await outcome('admin', `select * from staff_payments('everything')`)).toBe('invalid_range');
  });

  it('the detail shows the booking, guest, events and history, never the checkout address or event payloads', async () => {
    const p = await paid(at(upcoming(MON, 1), '17:00'));
    await db.query(`update payments set checkout_url = 'https://checkout.example/secret-access-code' where id = $1`, [p.id]);
    await db.query(`insert into payment_events (provider, event_id, event_type, payment_id, payload, processed_at)
      values ('mock', 'EV-1', 'charge.success', $1, '{"customer": {"email": "payer@example.com"}, "authorization": "AUTH_secret"}', now())`, [p.id]);
    const d = (await as('admin', () => one(db, `select staff_payment_detail($1) as d`, [p.id]))).d;
    expect(d.payment).toMatchObject({ status: 'succeeded', is_demo: true, provider: 'mock' });
    expect(d.booking).toMatchObject({ service_name: 'Swedish Massage', status: 'confirmed' });
    expect(d.events).toEqual([expect.objectContaining({ event_type: 'charge.success' })]);
    expect(d.history.map((h: any) => h.action)).toEqual(expect.arrayContaining(['insert', 'update']));
    expect(d.history.every((h: any) => h.actor_kind === 'system')).toBe(true);
    const text = JSON.stringify(d);
    expect(text).not.toContain('secret-access-code');
    expect(text).not.toContain('AUTH_secret');
    expect(JSON.stringify(await rows(db, `select * from audit_log where entity_type = 'payments'`))).not.toContain('secret-access-code');
  });
});

// ---------------------------------------------------------------------------
describe('manual refund records (Decision D)', () => {
  it('cash or bank transfer updates the refunded amount, capped at what was paid; the booking is untouched', async () => {
    const p = await paid(at(upcoming(WED, 1), '10:30'));
    const appointmentBefore = await one(db, `select * from appointments where id = $1`, [p.appointment_id]);
    const half = Number(p.paid_minor) / 2;
    const first = (await as('owner', () => one(db, RECORD, [p.id, half, 'bank_transfer', 'Guest asked for half back', p.v, 'TRF-001', 'Paid to GTBank']))).r;
    expect(first).toMatchObject({ status: 'partially_refunded', refund_status: 'processed' });
    expect(Number(first.refunded_minor)).toBe(half);
    const now = await payment(p.provider_reference);
    expect(await outcome('owner', RECORD, [p.id, half + 1, 'cash', 'More than left', now.v, null, null])).toBe('exceeds_refundable');
    const second = (await as('owner', () => one(db, RECORD, [p.id, half, 'cash', 'Rest in cash', now.v, null, null]))).r;
    expect(second).toMatchObject({ status: 'refunded', needs_refund: false });
    expect(Number(second.refundable_minor)).toBe(0);
    expect(await one(db, `select * from appointments where id = $1`, [p.appointment_id])).toEqual(appointmentBefore);
    const records = await rows(db, `select method, amount_minor, reference, recorded_by, is_demo from refund_records where payment_id = $1 order by recorded_at`, [p.id]);
    expect(records).toEqual([
      { method: 'bank_transfer', amount_minor: String(half), reference: 'TRF-001', recorded_by: id.owner, is_demo: true },
      { method: 'cash', amount_minor: String(half), reference: null, recorded_by: id.owner, is_demo: true },
    ].map((r) => ({ ...r, amount_minor: expect.anything() })));
  });

  it('"via provider dashboard" records intent only and never changes amounts', async () => {
    const p = await paid(at(upcoming(WED, 1), '15:30'));
    const r = (await as('owner', () => one(db, RECORD, [p.id, Number(p.paid_minor), 'provider_dashboard', 'Refunded in the Paystack dashboard', p.v, 'RFD-9', null]))).r;
    expect(r).toMatchObject({ status: 'succeeded', refund_status: 'pending' });
    expect(Number(r.refunded_minor)).toBe(0);
    // The provider's own refund event later becomes the source of truth.
    await service(() => db.query(`select record_refund_event('mock', $1, 'processed', 'RFD-9', $2)`, [p.provider_reference, p.paid_minor]));
    const after = await payment(p.provider_reference);
    expect(after).toMatchObject({ status: 'refunded', refund_status: 'processed' });
    expect(Number(after.refunded_minor)).toBe(Number(p.paid_minor));
  });

  it('refuses unpaid payments, stale versions, missing reasons and bad amounts', async () => {
    const p = await paid(at(upcoming(WED, 1), '17:00'));
    expect(await outcome('owner', RECORD, [p.id, 100, 'cash', 'Reason here', '2000-01-01 00:00:00+00', null, null])).toBe('stale_record');
    expect(await outcome('owner', RECORD, [p.id, 100, 'cash', '', p.v, null, null])).toBe('reason_required');
    expect(await outcome('owner', RECORD, [p.id, 0, 'cash', 'Reason here', p.v, null, null])).toBe('exceeds_refundable');
    expect(await outcome('owner', RECORD, [p.id, 100, 'cash', 'Reason here', p.v, 'x'.repeat(121), null])).toBe('invalid_refund');
    const failed = await one(db, `insert into payments (provider, provider_reference, amount_minor, is_test, status) values ('mock', 'FAILED-1', 100, true, 'failed') returning id, updated_at::text as v`);
    expect(await outcome('owner', RECORD, [failed.id, 100, 'cash', 'Reason here', failed.v, null, null])).toBe('not_refundable');
  });

  it('refund records cannot be changed or deleted by anyone, and are audited without the note', async () => {
    const r = await one(db, `select id from refund_records limit 1`);
    await expect(db.query(`update refund_records set amount_minor = 1 where id = $1`, [r.id])).rejects.toThrow(/refund_records_are_append_only/);
    await expect(db.query(`delete from refund_records where id = $1`, [r.id])).rejects.toThrow(/refund_records_are_append_only/);
    await expect(service(() => db.query(`delete from refund_records`))).rejects.toThrow(/permission denied/);
    const entries = await rows(db, `select * from audit_log where action = 'payment.refund_recorded' order by id`);
    expect(entries.length).toBeGreaterThanOrEqual(4);
    expect(entries.find((e) => e.reason === 'Guest asked for half back')).toMatchObject({ actor_id: id.owner, actor_role: 'owner' });
    expect(entries.filter((e) => e.entity_type === 'refund_records').map((e) => e.context.method)).toEqual(expect.arrayContaining(['bank_transfer', 'cash', 'provider_dashboard']));
    expect(JSON.stringify(entries)).not.toContain('Paid to GTBank');
  });
});

// ---------------------------------------------------------------------------
describe('staff accounts', () => {
  it('the owner sees every account with its email; an invitation is recorded without the email', async () => {
    const list = (await as('owner', () => one(db, `select owner_staff_list() as l`))).l;
    expect(list.staff.find((s: any) => s.id === id.newAccount)).toMatchObject({ email: 'new@example.com', role: 'therapist', is_active: false });
    expect(list.staff.find((s: any) => s.id === id.therapist).therapist).toMatchObject({ name: 'Senior Massage Therapist' });
    expect(list.therapists.length).toBe(4);
    const note = await one(db, `select * from audit_log where action = 'staff.invited' order by id desc limit 1`);
    expect(note).toMatchObject({ actor_id: id.owner, entity_type: 'profiles', entity_id: id.newAccount });
    expect(JSON.stringify(note)).not.toContain('new@example.com');
  });

  it('an invited account gets access only once the owner activates it, and loses it at once when deactivated', async () => {
    const invited = (await one(db, `insert into auth.users (email, raw_user_meta_data) values ('invited@example.com', '{"full_name": "Ada Invited", "role": "owner"}') returning id`)).id;
    id.invited = invited;
    const profile = await one(db, `select role, is_active, full_name, updated_at::text as v from profiles where id = $1`, [invited]);
    expect(profile).toMatchObject({ role: 'therapist', is_active: false, full_name: 'Ada Invited' }); // metadata never sets a role
    expect((await as('invited' as Actor, () => one(db, `select staff_whoami() as w`))).w.effective_role).toBeNull();
    await as('owner', () => db.query(`select owner_set_staff_role($1, 'admin', 'Front desk', $2)`, [invited, profile.v]));
    const p2 = await one(db, `select updated_at::text as v from profiles where id = $1`, [invited]);
    await as('owner', () => db.query(`select owner_set_staff_active($1, true, 'Started today', $2)`, [invited, p2.v]));
    expect((await as('invited' as Actor, () => one(db, `select staff_whoami() as w`))).w.effective_role).toBe('admin');
    expect((await as('invited' as Actor, () => rows(db, `select * from staff_payments('all')`))).length).toBeGreaterThan(0);
    const p3 = await one(db, `select updated_at::text as v from profiles where id = $1`, [invited]);
    await as('owner', () => db.query(`select owner_set_staff_active($1, false, 'Left', $2)`, [invited, p3.v]));
    expect(await outcome('invited' as Actor, `select * from staff_payments('all')`)).toBe('not_authorized');
    const actions = (await rows(db, `select action from audit_log where entity_id = $1 and actor_kind = 'staff' order by id`, [invited])).map((r) => r.action);
    expect(actions).toEqual(['staff.role_changed', 'staff.activated', 'staff.deactivated']);
  });

  it('the last active owner is still protected', async () => {
    const me = await one(db, `select updated_at::text as v from profiles where id = $1`, [id.owner]);
    expect(await outcome('owner', `select owner_set_staff_role($1, 'admin', 'stepping down', $2)`, [id.owner, me.v])).toBe('last_owner');
    expect(await outcome('owner', `select owner_set_staff_active($1, false, 'leaving', $2)`, [id.owner, me.v])).toBe('last_owner');
  });
});

// ---------------------------------------------------------------------------
describe('settings and the audit viewer', () => {
  it('settings show the demo-payment switch but no function changes it', async () => {
    const s = (await as('admin', () => one(db, `select staff_settings() as s`))).s;
    expect(s).toMatchObject({ allow_demo_payments: true, online_payment_enabled: true, payment_mode: 'full', currency: 'NGN' });
    const writers = await rows(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ~* 'allow_demo_payments\\s*='`);
    expect(writers).toEqual([]);
  });

  it('the audit viewer filters, pages backwards and names actors', async () => {
    const page1 = await as('admin', () => rows(db, `select * from staff_audit_log(null, null, null, null, 3)`));
    expect(page1).toHaveLength(3);
    const page2 = await as('admin', () => rows(db, `select * from staff_audit_log(null, null, null, $1, 3)`, [page1[2].id]));
    expect(Number(page2[0].id)).toBeLessThan(Number(page1[2].id));
    const refunds = await as('owner', () => rows(db, `select * from staff_audit_log(array['refund_records', 'payments'], null, 'payment.')`));
    expect(refunds.every((r) => r.action.startsWith('payment.'))).toBe(true);
    expect(refunds[0].actor_name).toBe('Olu Owner');
    const staffOnly = await as('owner', () => rows(db, `select * from staff_audit_log(array['profiles'], $1)`, [id.invited]));
    expect(staffOnly.every((r) => r.entity_id === id.invited)).toBe(true);
    expect(await outcome('admin', `select * from staff_audit_log(null, null, null, null, 1000)`)).toBe('invalid_range');
  });

  it('the dashboard counts payments left waiting on the provider', async () => {
    const dash = (await as('owner', () => one(db, `select staff_dashboard() as d`))).d;
    expect(dash).toHaveProperty('payments_waiting');
  });
});
