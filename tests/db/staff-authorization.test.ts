import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createStaff, createTestDb, one, rows } from './harness';

// Phase 5a: who may do what. Every check here is enforced by the database
// (grants, RLS and the staff functions), never by the staff app.

let db: PGlite;
const id: Record<string, string> = {};
let therapistA: string;
let therapistB: string;

type Actor = 'anon' | 'newAccount' | 'inactiveAdmin' | 'therapist' | 'admin' | 'owner';
const ACTORS: Actor[] = ['anon', 'newAccount', 'inactiveAdmin', 'therapist', 'admin', 'owner'];

/** Runs `fn` as an actor. `aal` simulates the session's authentication level. */
async function as<T>(actor: Actor, fn: () => Promise<T>, aal?: 'aal1' | 'aal2'): Promise<T> {
  if (actor === 'anon') return asRole(db, 'anon', null, fn);
  const claims = JSON.stringify({ sub: id[actor], role: 'authenticated', ...(aal ? { aal } : {}) });
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  try {
    return await asRole(db, 'authenticated', id[actor], fn);
  } finally {
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}
async function outcome(actor: Actor, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await as(actor, () => db.query(sql, params));
    return 'ok';
  } catch (err: any) {
    if (/permission denied/.test(err.message)) return 'denied';
    return err.message;
  }
}
const profile = (who: string) => one(db, `select * from profiles where id = $1`, [who]);
const settings = () => one(db, `select * from business_settings`);

beforeAll(async () => {
  db = await createTestDb();
  id.owner = await createStaff(db, 'owner@example.com', 'owner');
  id.admin = await createStaff(db, 'admin@example.com', 'admin');
  id.therapist = await createStaff(db, 'therapist@example.com', 'therapist');
  id.inactiveAdmin = await createStaff(db, 'inactive@example.com', 'admin', { active: false });
  // A brand-new account: the sign-up trigger made it an inactive therapist.
  id.newAccount = (await one(db, `insert into auth.users (email) values ('new@example.com') returning id`)).id;
  therapistA = (await one(db, `update therapists set profile_id = $1 where sort_order = 1 returning id`, [id.therapist])).id;
  therapistB = (await one(db, `select id from therapists where sort_order = 2`)).id;
});

describe('identity', () => {
  it('staff_whoami reports the account without granting anything', async () => {
    expect(await outcome('anon', `select staff_whoami()`)).toBe('denied');
    const fresh = (await as('newAccount', () => one(db, `select staff_whoami() as w`))).w;
    expect(fresh).toMatchObject({ effective_role: null, therapist_id: null, profile: { role: 'therapist', is_active: false } });
    const owner = (await as('owner', () => one(db, `select staff_whoami() as w`))).w;
    expect(owner).toMatchObject({ effective_role: 'owner', session_aal: 'aal1', required_aal: 'aal1', profile: { is_active: true } });
    const therapist = (await as('therapist', () => one(db, `select staff_whoami() as w`))).w;
    expect(therapist).toMatchObject({ effective_role: 'therapist', therapist_id: therapistA });
    expect((await as('inactiveAdmin', () => one(db, `select staff_whoami() as w`))).w.effective_role).toBeNull();
  });
});

describe('staff functions: who may call them', () => {
  const now = `now()`; // placeholders; each call below fails or succeeds on authorization first
  const calls: Record<string, { sql: () => Promise<[string, unknown[]]>; allowed: Actor[] }> = {
    owner_set_staff_role: {
      sql: async () => [`select owner_set_staff_role($1, 'admin', 'testing access', $2)`, [id.inactiveAdmin, (await profile(id.inactiveAdmin)).updated_at]],
      allowed: ['owner'],
    },
    owner_set_staff_active: {
      sql: async () => [`select owner_set_staff_active($1, false, 'testing access', $2)`, [id.newAccount, (await profile(id.newAccount)).updated_at]],
      allowed: ['owner'],
    },
    owner_link_therapist: {
      sql: async () => [`select owner_link_therapist($1, null, 'testing access', (select updated_at from therapists where id = $1))`, [therapistB]],
      allowed: ['owner'],
    },
    owner_update_payment_settings: {
      sql: async () => [`select owner_update_payment_settings($1, 'testing access')`, [(await settings()).updated_at]],
      allowed: ['owner'],
    },
    staff_update_booking_rules: {
      sql: async () => [`select staff_update_booking_rules($1, 'testing access')`, [(await settings()).updated_at]],
      allowed: ['owner', 'admin'],
    },
    staff_update_own_profile: {
      sql: async () => [`select staff_update_own_profile('Same Name', null, (select updated_at from profiles where id = auth.uid()))`, []],
      allowed: ['owner', 'admin', 'therapist'],
    },
    therapist_agenda: {
      sql: async () => [`select * from therapist_agenda(${now}, ${now} + interval '7 days')`, []],
      allowed: ['therapist'],
    },
  };

  for (const [name, call] of Object.entries(calls)) {
    it(`${name}: only ${call.allowed.join(', ')}`, async () => {
      for (const actor of ACTORS) {
        const [sql, params] = await call.sql();
        const result = await outcome(actor, sql, params);
        if (call.allowed.includes(actor)) expect(result, `${name} as ${actor}`).toBe('ok');
        else expect(result, `${name} as ${actor}`).toMatch(actor === 'anon' ? /^denied$/ : /^(denied|not_authorized)$/);
      }
    });
  }
});

describe('direct table writes are refused (decision B)', () => {
  it.each(['owner', 'admin', 'therapist'] as Actor[])('%s cannot write appointments, profiles or settings directly', async (actor) => {
    expect(await outcome(actor, `update appointments set status = 'cancelled'`)).toBe('denied');
    expect(await outcome(actor, `delete from appointments`)).toBe('denied');
    expect(await outcome(actor, `insert into appointments (customer_id, service_id, therapist_id, starts_at, ends_at, blocked_until, price_minor) select c.id, s.id, t.id, now() + interval '9 days', now() + interval '9 days 1 hour', now() + interval '9 days 75 minutes', 1 from customers c, services s, therapists t limit 1`)).toBe('denied');
    expect(await outcome(actor, `update profiles set role = 'owner' where id = auth.uid()`)).toBe('denied');
    expect(await outcome(actor, `update business_settings set allow_demo_payments = true`)).toBe('denied');
    expect(await outcome(actor, `update business_settings set online_payment_enabled = false`)).toBe('denied');
    expect(await outcome(actor, `delete from customers`)).toBe('denied');
    expect(await outcome(actor, `update therapists set profile_id = auth.uid()`)).toBe('denied');
    expect(await outcome(actor, `insert into therapists (display_name, profile_id) values ('X', auth.uid())`)).toBe('denied');
    // Decision H: deactivate, never delete.
    expect(await outcome(actor, `delete from services where slug = 'swedish'`)).toBe('denied');
    expect(await outcome(actor, `delete from therapists`)).toBe('denied');
    expect(await outcome(actor, `delete from dispatch_zones`)).toBe('denied');
  });

  it('owner/admin keep catalogue and schedule management, and customer master edits', async () => {
    expect(await outcome('admin', `update services set name = name where slug = 'swedish'`)).toBe('ok');
    expect(await outcome('admin', `update therapists set bio = bio where sort_order = 1`)).toBe('ok');
    expect(await outcome('admin', `insert into blackout_dates (starts_at, ends_at, reason) values (now() + interval '50 days', now() + interval '51 days', 'test') `)).toBe('ok');
    expect(await outcome('admin', `update customers set staff_notes = 'prefers mornings' where email = 'demo.ada@example.com'`)).toBe('ok');
    expect(await outcome('therapist', `update services set price_minor = 1`)).toBe('ok'); // runs, but RLS lets it change nothing
    expect(Number((await one(db, `select price_minor from services where slug = 'swedish'`)).price_minor)).toBe(4_000_000);
  });

  it('allow_demo_payments cannot be changed from the app by anyone', async () => {
    const before = (await settings()).allow_demo_payments;
    await as('owner', async () => one(db, `select owner_update_payment_settings($1, 'turn things on', true, 'full', 50)`, [(await settings()).updated_at]));
    expect((await settings()).allow_demo_payments).toBe(before);
    const fns = await rows(db, `select p.proname, pg_get_function_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and pg_get_function_arguments(p.oid) ilike '%demo%'`);
    expect(fns).toEqual([]);
  });
});

describe('roles and the last owner', () => {
  it('an admin cannot promote themselves or anyone else', async () => {
    const me = await profile(id.admin);
    expect(await outcome('admin', `select owner_set_staff_role($1, 'owner', 'promote me please', $2)`, [id.admin, me.updated_at])).toBe('not_authorized');
    expect((await profile(id.admin)).role).toBe('admin');
  });

  it('the only owner cannot demote or deactivate themselves; with a second owner they can', async () => {
    const me = await profile(id.owner);
    expect(await outcome('owner', `select owner_set_staff_role($1, 'admin', 'stepping down', $2)`, [id.owner, me.updated_at])).toBe('last_owner');
    expect(await outcome('owner', `select owner_set_staff_active($1, false, 'leaving', $2)`, [id.owner, me.updated_at])).toBe('last_owner');
    // Not even server-side code can remove the last owner.
    await expect(asRole(db, 'service_role', null, () => db.query(`update profiles set is_active = false where id = $1`, [id.owner]))).rejects.toThrow(/last_owner/);
    await expect(db.query(`delete from auth.users where id = $1`, [id.owner])).rejects.toThrow(/last_owner/);

    const second = await createStaff(db, 'owner2@example.com', 'owner');
    expect(await outcome('owner', `select owner_set_staff_role($1, 'admin', 'handing over', $2)`, [id.owner, (await profile(id.owner)).updated_at])).toBe('ok');
    expect((await profile(id.owner)).role).toBe('admin');
    // Restore for the remaining tests.
    await db.query(`update profiles set role = 'owner' where id = $1`, [id.owner]);
    await db.query(`update profiles set is_active = false where id = $1`, [second]);
  });

  it('deactivation takes effect on the very next request', async () => {
    const temp = await createStaff(db, 'temp.admin@example.com', 'admin');
    id.temp = temp;
    const seenBefore = await as('temp' as Actor, () => rows(db, `select id from customers`));
    expect(seenBefore.length).toBeGreaterThan(0);
    await as('owner', async () => one(db, `select owner_set_staff_active($1, false, 'left the business', $2)`, [temp, (await profile(temp)).updated_at]));
    expect(await as('temp' as Actor, () => rows(db, `select id from customers`))).toEqual([]);
  });

  it('linking a therapist record to an account is owner-only and grants that therapist\'s agenda', async () => {
    const other = await createStaff(db, 'therapist.b@example.com', 'therapist');
    id.other = other;
    expect(await as('other' as Actor, () => one(db, `select staff_whoami() as w`))).toMatchObject({ w: { therapist_id: null } });
    const updatedAt = (await one(db, `select updated_at from therapists where id = $1`, [therapistB])).updated_at;
    expect(await outcome('admin', `select owner_link_therapist($1, $2, 'link account', $3)`, [therapistB, other, updatedAt])).toBe('not_authorized');
    expect(await outcome('owner', `select owner_link_therapist($1, $2, 'link account', $3)`, [therapistB, other, updatedAt])).toBe('ok');
    expect(await as('other' as Actor, () => one(db, `select staff_whoami() as w`))).toMatchObject({ w: { therapist_id: therapistB } });
  });
});

describe('edits need a reason and the current version', () => {
  it('refuses a missing reason and an out-of-date version', async () => {
    const s = await settings();
    expect(await outcome('owner', `select staff_update_booking_rules($1, '  ')`, [s.updated_at])).toBe('reason_required');
    expect(await outcome('owner', `select staff_update_booking_rules($1, 'valid reason')`, ['2000-01-01T00:00:00Z'])).toBe('stale_record');
    expect(await outcome('owner', `select staff_update_booking_rules(null, 'valid reason')`)).toBe('stale_record');
  });

  it('booking rules are validated by the database and take effect for guests at once', async () => {
    const s = await settings();
    expect(await outcome('admin', `select staff_update_booking_rules($1, 'bad grid', null, null, null, null, 2)`, [s.updated_at])).toMatch(/check constraint/);
    await as('admin', () => one(db, `select staff_update_booking_rules($1, 'hourly slots', null, null, null, null, 60)`, [s.updated_at]));
    const swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
    const monday = new Date(Date.now() + 9 * 86_400_000);
    while (monday.getUTCDay() !== 1) monday.setUTCDate(monday.getUTCDate() + 1);
    const slots = await asRole(db, 'anon', null, () => rows(db, `select starts_at from get_available_slots($1, $2) limit 3`, [swedish, monday.toISOString().slice(0, 10)]));
    expect(slots.every((r) => new Date(r.starts_at).getUTCMinutes() === 0)).toBe(true);
    await as('admin', async () => one(db, `select staff_update_booking_rules($1, 'back to half hours', null, null, null, null, 30)`, [(await settings()).updated_at]));
  });

  it('staff can update only their own name and phone', async () => {
    const before = await profile(id.therapist);
    await as('therapist', () => one(db, `select staff_update_own_profile('Renamed Therapist', '+2348011112222', $1)`, [before.updated_at]));
    const after = await profile(id.therapist);
    expect(after).toMatchObject({ full_name: 'Renamed Therapist', phone: '+2348011112222', role: 'therapist', is_active: true });
    expect(await outcome('therapist', `select staff_update_own_profile('X', 'not a phone', $1)`, [after.updated_at])).toBe('invalid_profile');
  });
});

describe('two-factor readiness (decision K)', () => {
  it('requiring a stronger session for owners locks out password-only owner sessions everywhere', async () => {
    await db.query(`update private.auth_policy set required_aal = 'aal2' where role = 'owner'`);
    try {
      const weak = (await as('owner', () => one(db, `select staff_whoami() as w`), 'aal1')).w;
      expect(weak).toMatchObject({ effective_role: null, required_aal: 'aal2', session_aal: 'aal1' });
      expect(await as('owner', () => rows(db, `select id from customers`), 'aal1')).toEqual([]);
      expect(await outcome('owner', `select staff_update_booking_rules($1, 'needs mfa')`, [(await settings()).updated_at])).toBe('not_authorized');

      const strong = (await as('owner', () => one(db, `select staff_whoami() as w`), 'aal2')).w;
      expect(strong).toMatchObject({ effective_role: 'owner', session_aal: 'aal2' });
      expect((await as('owner', () => rows(db, `select id from customers`), 'aal2')).length).toBeGreaterThan(0);
      // Other roles are unaffected.
      expect((await as('admin', () => rows(db, `select id from customers`))).length).toBeGreaterThan(0);
    } finally {
      await db.query(`update private.auth_policy set required_aal = 'aal1'`);
    }
  });
});

describe('therapist agenda', () => {
  it('shows only the therapist\'s own appointments, with booking contact details and no email or staff notes', async () => {
    const appt = await one(db, `select * from appointments where therapist_id = $1`, [therapistA]);
    await db.query(`update appointments set contact_name = 'Booking Contact', contact_phone = '+2348000001111' where id = $1`, [appt.id]);
    const agenda = await as('therapist', () => rows(db, `select * from therapist_agenda(now() - interval '1 day', now() + interval '30 days')`));
    expect(agenda).toHaveLength(1);
    expect(agenda[0]).toMatchObject({ appointment_id: appt.id, contact_name: 'Booking Contact', contact_phone: '+2348000001111', payment_state: 'to_collect' });
    expect(Object.keys(agenda[0]).sort()).toEqual([
      'appointment_id', 'contact_name', 'contact_phone', 'customer_notes', 'duration_minutes', 'ends_at', 'is_demo', 'location_type',
      'payment_state', 'reference', 'service_address', 'service_name', 'starts_at', 'status', 'zone_name',
    ]);
    expect(JSON.stringify(agenda)).not.toContain('@example.com');
    expect(JSON.stringify(agenda)).not.toContain('prefers mornings'); // staff notes
  });

  it('marks paid appointments, and refuses unreasonable ranges', async () => {
    const appt = await one(db, `select id from appointments where therapist_id = $1`, [therapistA]);
    await db.query(`insert into payments (appointment_id, provider, provider_reference, amount_minor, paid_minor, is_test, status) values ($1, 'mock', 'AGENDA-PAID-1', 4000000, 4000000, true, 'succeeded')`, [appt.id]);
    const [row] = await as('therapist', () => rows(db, `select payment_state from therapist_agenda(now() - interval '1 day', now() + interval '30 days')`));
    expect(row.payment_state).toBe('paid');
    expect(await outcome('therapist', `select * from therapist_agenda(now(), now() + interval '90 days')`)).toBe('invalid_range');
  });
});
