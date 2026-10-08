import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createStaff, createTestDb, one, rows } from './harness';
import { at, upcoming, MON, THU, TUE, WED } from './dates';

// Phase 5 hardening: every staff function that needs a reason checks the
// caller's role first. Someone without access is told "not_authorized"
// whether or not they gave a reason; authorised staff still get
// "reason_required" without one, and the action works with one.

let db: PGlite;
const id: Record<string, string> = {};
let swedish: string;
let therapistB: string;

type Actor = 'owner' | 'admin' | 'therapist' | 'newAccount';
async function outcome(actor: Actor, sql: string, params: unknown[]): Promise<string> {
  try {
    await asRole(db, 'authenticated', id[actor], () => db.query(sql, params));
    return 'ok';
  } catch (err: any) {
    return /permission denied/.test(err.message) ? 'denied' : err.message;
  }
}
const v = async (table: string, rowId: string) => (await one(db, `select updated_at::text as v from ${table} where id = $1`, [rowId])).v;
const settingsVersion = async () => (await one(db, `select updated_at::text as v from business_settings`)).v;
const BOOK = (reasonParam: string) => `select * from staff_create_booking(p_source => 'phone', p_settlement => 'pay_at_venue',
  p_service_id => $1, p_starts_at => $2, p_reason => ${reasonParam}, p_therapist_id => $3,
  p_customer_name => 'Order Guest', p_customer_phone => '+2348035550101')`;
async function phoneBooking(start: Date) {
  return asRole(db, 'authenticated', id.admin, () => one(db, BOOK(`'setup'`), [swedish, start.toISOString(), therapistB]));
}

interface Case {
  fn: string;
  allowed: Actor[];
  /** The call with the given reason (null = missing). */
  call: (reason: string | null) => Promise<[string, unknown[]]>;
}
let cases: Case[];

beforeAll(async () => {
  db = await createTestDb();
  id.owner = await createStaff(db, 'owner@example.com', 'owner');
  id.admin = await createStaff(db, 'admin@example.com', 'admin');
  id.therapist = await createStaff(db, 'therapist@example.com', 'therapist');
  id.newAccount = (await one(db, `insert into auth.users (email) values ('new@example.com') returning id`)).id;
  const roleTarget = (await one(db, `insert into auth.users (email) values ('role.target@example.com') returning id`)).id;
  const activeTarget = (await one(db, `insert into auth.users (email) values ('active.target@example.com') returning id`)).id;
  const linkTarget = await createStaff(db, 'link.target@example.com', 'therapist');
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  therapistB = (await one(db, `select id from therapists where sort_order = 2`)).id;
  const linkTherapist = (await one(db, `select id from therapists where sort_order = 4`)).id;

  const toMove = await phoneBooking(at(upcoming(WED, 1), '10:30'));
  const toCancel = await phoneBooking(at(upcoming(THU, 1), '10:30'));
  const toSettle = await phoneBooking(at(upcoming(TUE, 1), '10:30'));
  // A paid online booking, for the refund record.
  const hold = await asRole(db, 'service_role', null, () => one(db, `select * from request_booking_hold($1, $2, $3)`, [swedish, at(upcoming(MON, 2), '10:30').toISOString(), therapistB]));
  await db.query(`select attach_customer_to_hold($1, 'Paying Guest', 'order.payer@example.com', '+2348035550102')`, [hold.hold_token]);
  const { p } = await one(db, `select begin_hold_payment($1, 'mock', true) as p`, [hold.hold_token]);
  await db.query(`select record_payment_result('mock', $1, 'success', $2, 'NGN')`, [p.reference, p.amount_minor]);
  const payment = await one(db, `select id from payments where provider_reference = $1`, [p.reference]);

  const owners: Actor[] = ['owner'];
  const managers: Actor[] = ['owner', 'admin'];
  cases = [
    { fn: 'owner_set_staff_role', allowed: owners, call: async (r) => [`select owner_set_staff_role($1, 'admin', $2, $3)`, [roleTarget, r, await v('profiles', roleTarget)]] },
    { fn: 'owner_set_staff_active', allowed: owners, call: async (r) => [`select owner_set_staff_active($1, true, $2, $3)`, [activeTarget, r, await v('profiles', activeTarget)]] },
    { fn: 'owner_link_therapist', allowed: owners, call: async (r) => [`select owner_link_therapist($1, $2, $3, $4)`, [linkTherapist, linkTarget, r, await v('therapists', linkTherapist)]] },
    { fn: 'owner_update_payment_settings', allowed: owners, call: async (r) => [`select owner_update_payment_settings($1, $2, true, 'full', 45)`, [await settingsVersion(), r]] },
    { fn: 'owner_record_refund', allowed: owners, call: async (r) => [`select owner_record_refund($1, 1000, 'cash', $2, $3)`, [payment.id, r, await v('payments', payment.id)]] },
    { fn: 'staff_update_booking_rules', allowed: managers, call: async (r) => [`select staff_update_booking_rules($1, $2, null, 12)`, [await settingsVersion(), r]] },
    { fn: 'staff_create_booking', allowed: managers, call: async (r) => [BOOK('$4'), [swedish, at(upcoming(MON, 1), '10:30').toISOString(), therapistB, r]] },
    { fn: 'staff_reschedule_appointment', allowed: managers, call: async (r) => [`select staff_reschedule_appointment($1, $2, $3, $4)`, [toMove.id, at(upcoming(WED, 1), '15:30').toISOString(), r, await v('appointments', toMove.id)]] },
    { fn: 'staff_cancel_appointment', allowed: managers, call: async (r) => [`select staff_cancel_appointment($1, $2, $3)`, [toCancel.id, r, await v('appointments', toCancel.id)]] },
    { fn: 'staff_set_settlement', allowed: managers, call: async (r) => [`select staff_set_settlement($1, 'paid_offline', $2, $3)`, [toSettle.id, r, await v('appointments', toSettle.id)]] },
  ];
});

describe('the role is checked before the reason', () => {
  it('covers every staff function that takes a required reason', () => {
    expect(cases.map((c) => c.fn).sort()).toEqual([
      'owner_link_therapist', 'owner_record_refund', 'owner_set_staff_active', 'owner_set_staff_role', 'owner_update_payment_settings',
      'staff_cancel_appointment', 'staff_create_booking', 'staff_reschedule_appointment', 'staff_set_settlement', 'staff_update_booking_rules',
    ]);
  });

  it('an unauthorised caller is told "not_authorized", with or without a reason', async () => {
    for (const c of cases) {
      for (const actor of (['owner', 'admin', 'therapist', 'newAccount'] as Actor[]).filter((a) => !c.allowed.includes(a))) {
        for (const reason of [null, '', '  ', 'A perfectly good reason']) {
          const [sql, params] = await c.call(reason);
          expect(await outcome(actor, sql, params), `${c.fn} as ${actor}, reason ${JSON.stringify(reason)}`).toBe('not_authorized');
        }
      }
    }
  });

  it('an authorised caller without a reason is told "reason_required", and nothing changes', async () => {
    const before = await rows(db, `select count(*)::int as n from audit_log`);
    for (const c of cases) {
      for (const reason of [null, '', 'ab']) {
        const [sql, params] = await c.call(reason);
        expect(await outcome(c.allowed[c.allowed.length - 1], sql, params), `${c.fn}, reason ${JSON.stringify(reason)}`).toBe('reason_required');
      }
    }
    expect(await rows(db, `select count(*)::int as n from audit_log`)).toEqual(before);
  });

  it('an authorised caller with a valid reason succeeds, and the reason is recorded', async () => {
    for (const c of cases) {
      const [sql, params] = await c.call(`Valid reason for ${c.fn}`);
      expect(await outcome(c.allowed[c.allowed.length - 1], sql, params), c.fn).toBe('ok');
      expect((await rows(db, `select 1 from audit_log where reason = $1`, [`Valid reason for ${c.fn}`])).length, c.fn).toBeGreaterThan(0);
    }
  });

  it('guests are still refused by the grants before anything runs', async () => {
    for (const c of cases) {
      const [sql, params] = await c.call('A perfectly good reason');
      await expect(asRole(db, 'anon', null, () => db.query(sql, params)), c.fn).rejects.toThrow(/permission denied/);
    }
  });

  it('no staff function validates a reason before checking the role (regression guard)', async () => {
    const fns = await rows(db, `
      select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc like '%require_reason(%'`);
    expect(fns.length).toBeGreaterThanOrEqual(11);
    for (const f of fns) {
      const role = Math.min(...['private.require_staff(', 'private.begin_schedule_change('].map((s) => f.prosrc.indexOf(s)).filter((i) => i >= 0));
      expect(Number.isFinite(role), `${f.proname} checks a role`).toBe(true);
      expect(role, `${f.proname}: role check before the reason`).toBeLessThan(f.prosrc.indexOf('require_reason('));
    }
  });
});
