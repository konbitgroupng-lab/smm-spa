import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createStaff, createTestDb, one, rows } from './harness';

// Phase 5a: the audit log, and what guests can and cannot reach.

let db: PGlite;
let owner: string;
let admin: string;
let therapist: string;

const latest = (entityType: string, n = 1) =>
  rows(db, `select * from audit_log where entity_type = $1 order by id desc limit $2`, [entityType, n]);

beforeAll(async () => {
  db = await createTestDb();
  owner = await createStaff(db, 'owner@example.com', 'owner');
  admin = await createStaff(db, 'admin@example.com', 'admin');
  therapist = await createStaff(db, 'therapist@example.com', 'therapist');
});

describe('audit coverage', () => {
  it('every staff-managed table is audited', async () => {
    const audited = await rows(db, `
      select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgname = 'audit_row_change' order by 1`);
    expect(audited.map((r) => r.relname)).toEqual([
      'announcements', 'appointments', 'blackout_dates', 'business_hours', 'business_settings', 'customers', 'dispatch_zones',
      'faqs', 'gallery_items', 'media_assets', 'payments', 'profiles',
      'refund_records', 'service_package_items', 'services', 'site_content', 'testimonials', 'therapist_breaks',
      'therapist_schedules', 'therapist_services', 'therapist_time_off', 'therapists',
    ]); // Phase 6a added the six website content tables
  });

  it('a staff function records the actor, role, named action, reason and the change', async () => {
    const s = await one(db, `select * from business_settings`);
    await asRole(db, 'authenticated', admin, () =>
      db.query(`select staff_update_booking_rules($1, 'Longer holds for phone payments', null, 20)`, [s.updated_at]));
    const [entry] = await latest('business_settings');
    expect(entry).toMatchObject({
      actor_id: admin, actor_role: 'admin', actor_kind: 'staff', action: 'settings.booking_rules_changed',
      entity_id: String(s.id), reason: 'Longer holds for phone payments',
      changes: { hold_minutes: { old: s.hold_minutes, new: 20 } },
    });
    expect(Object.keys(entry.changes)).toEqual(['hold_minutes']); // no updated_at noise
  });

  it('role changes are recorded with before and after', async () => {
    const p = await one(db, `select * from profiles where id = $1`, [therapist]);
    await asRole(db, 'authenticated', owner, () =>
      db.query(`select owner_set_staff_role($1, 'admin', 'Now runs the front desk', $2)`, [therapist, p.updated_at]));
    const [entry] = await latest('profiles');
    expect(entry).toMatchObject({
      actor_id: owner, actor_role: 'owner', action: 'staff.role_changed', entity_id: therapist,
      reason: 'Now runs the front desk', changes: { role: { old: 'therapist', new: 'admin' } },
    });
    await db.query(`update profiles set role = 'therapist' where id = $1`, [therapist]);
  });

  it('catalogue edits by staff are recorded with their action', async () => {
    // Phase 5c: through staff_save_service (direct writes are refused).
    const s = await one(db, `select * from services where slug = 'swedish'`);
    const fields = {
      slug: s.slug, name: s.name, category: s.category, description: s.description, benefits: s.benefits,
      duration_minutes: s.duration_minutes, buffer_minutes: s.buffer_minutes, price_minor: 4100000,
      compare_at_price_minor: null, is_popular: s.is_popular, is_active: s.is_active, sort_order: s.sort_order,
    };
    await asRole(db, 'authenticated', admin, () => db.query(`select staff_save_service($1, $2, $3)`, [s.id, s.updated_at, JSON.stringify(fields)]));
    const [entry] = await latest('services');
    expect(entry).toMatchObject({ actor_id: admin, actor_kind: 'staff', action: 'catalogue.service_updated', reason: null,
      changes: { price_minor: { old: 4000000, new: 4100000 } } });
    expect(Object.keys(entry.changes)).toEqual(['price_minor']);
  });

  it('guest bookings and server processes are recorded as system', async () => {
    const appt = await one(db, `select id, status from appointments limit 1`);
    await asRole(db, 'service_role', null, () => db.query(`update appointments set status = 'cancelled' where id = $1`, [appt.id]));
    const [entry] = await latest('appointments');
    expect(entry).toMatchObject({ actor_id: null, actor_role: null, actor_kind: 'system', action: 'update', entity_id: appt.id });
    expect(entry.changes.status).toEqual({ old: appt.status, new: 'cancelled' });
  });

  it('labels apply only to the change they were set for', async () => {
    await db.exec('begin');
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [owner]);
      await db.exec('set local role authenticated');
      const p = await one(db, `select updated_at from profiles where id = $1`, [owner]);
      await db.query(`select staff_update_own_profile('Owner Name', null, $1)`, [p.updated_at]);
      // A later change in the same transaction (here by server-side code) carries no label.
      await db.exec('reset role');
      await db.query(`update services set sort_order = sort_order + 1 where slug = 'swedish'`);
    } finally {
      await db.exec('commit');
    }
    const [service] = await latest('services');
    expect(service).toMatchObject({ action: 'update', reason: null, context: {} });
    const [profile] = await latest('profiles');
    expect(profile.action).toBe('staff.profile_updated');
  });
});

describe('personal data is not copied into the log', () => {
  it('records only that personal fields changed', async () => {
    const ada = await one(db, `select id, full_name, email, updated_at::text from customers where email = 'demo.ada@example.com'`);
    await asRole(db, 'authenticated', admin, () =>
      db.query(`select staff_update_customer($1, $2, $3, $4, '+2340000009999', 'Gate code 4411')`, [ada.id, ada.updated_at, ada.full_name, ada.email]));
    const [entry] = await latest('customers');
    expect(entry.action).toBe('customer.updated');
    expect(entry.changes).toEqual({ phone: { changed: true }, staff_notes: { changed: true } });

    const p = await one(db, `select updated_at from profiles where id = $1`, [therapist]);
    await asRole(db, 'authenticated', therapist, () =>
      db.query(`select staff_update_own_profile('Private Person', '+2348099990000', $1)`, [p.updated_at]));
    expect((await latest('profiles'))[0].changes).toEqual({ full_name: { changed: true }, phone: { changed: true } });

    await db.query(`update appointments set contact_name = 'Someone Else', contact_phone = '+2348077776666', service_address = '12 Secret Close', customer_notes = 'Bad back'`);
    const [appt] = await latest('appointments');
    expect(appt.changes).toEqual({ contact_name: { changed: true }, contact_phone: { changed: true },
      service_address: { changed: true }, customer_notes: { changed: true } });
  });

  it('new rows are recorded without their values; removed rows keep only non-personal values', async () => {
    const c = await asRole(db, 'authenticated', admin, () =>
      one(db, `select (staff_create_customer('Walk In', 'walk.in@example.com', '+2348012340000')).id`));
    const [created] = await latest('customers');
    expect(created).toMatchObject({ action: 'customer.created', entity_id: c.id, changes: {} });

    await db.query(`delete from customers where id = $1`, [c.id]); // only server-side code may delete
    const [removed] = await latest('customers');
    expect(removed.action).toBe('delete');
    expect(removed.changes).not.toHaveProperty('full_name');
    expect(removed.changes).not.toHaveProperty('email');
    expect(removed.changes).not.toHaveProperty('phone');
    expect(removed.changes.id).toEqual({ old: c.id });
  });

  it('no personal value appears anywhere in the log', async () => {
    const everything = JSON.stringify(await rows(db, `select * from audit_log`));
    for (const value of ['demo.ada@example.com', '+2340000009999', 'Gate code', 'Private Person', '+2348099990000',
      'Someone Else', '+2348077776666', 'Secret Close', 'Bad back', 'walk.in@example.com', 'Walk In', '+2348012340000']) {
      expect(everything).not.toContain(value);
    }
  });
});

describe('the log cannot be changed', () => {
  it('nobody can edit, delete or clear entries, not even server-side code', async () => {
    const { id } = await one(db, `select max(id) as id from audit_log`);
    for (const role of ['authenticated', 'service_role'] as const) {
      const user = role === 'authenticated' ? owner : null;
      await expect(asRole(db, role, user, () => db.query(`update audit_log set reason = 'x' where id = $1`, [id]))).rejects.toThrow(/permission denied/);
      await expect(asRole(db, role, user, () => db.query(`delete from audit_log where id = $1`, [id]))).rejects.toThrow(/permission denied/);
      await expect(asRole(db, role, user, () => db.query(`insert into audit_log (actor_kind, action, entity_type) values ('staff', 'fake', 'x')`))).rejects.toThrow(/permission denied/);
    }
    // Even the table owner is stopped by the append-only trigger.
    await expect(db.query(`update audit_log set reason = 'x' where id = $1`, [id])).rejects.toThrow(/audit_log_is_append_only/);
    await expect(db.query(`delete from audit_log where id = $1`, [id])).rejects.toThrow(/audit_log_is_append_only/);
    await expect(db.query(`truncate audit_log`)).rejects.toThrow(/audit_log_is_append_only/);
  });

  it('only owner and admin can read it', async () => {
    const count = Number((await one(db, `select count(*) from audit_log`)).count);
    expect(count).toBeGreaterThan(5);
    const seen = (user: string) => asRole(db, 'authenticated', user, () => one(db, `select count(*) from audit_log`)).then((r) => Number(r.count));
    expect(await seen(owner)).toBe(count);
    expect(await seen(admin)).toBe(count);
    expect(await seen(therapist)).toBe(0);
    await expect(asRole(db, 'anon', null, () => db.query(`select * from audit_log`))).rejects.toThrow(/permission denied/);
  });
});

describe('guests (anon) reach only the public catalogue and the availability search', () => {
  it('anon can read 14 public tables and write none', async () => {
    const grants = await rows(db, `
      select table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
      from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'
      group by table_name order by table_name`);
    // Whole-table reads: the catalogue and settings.
    expect(grants).toEqual([
      'business_hours', 'business_settings', 'dispatch_zones', 'intake_questions',
      'service_package_items', 'services', 'therapist_services', 'therapists',
    ].map((table_name) => ({ table_name, privileges: 'SELECT' })));
    // Phase 6a: the six website content tables are readable by named column only
    // (tests/db/content-security.test.ts pins the columns).
    const byColumn = await rows(db, `
      select distinct table_name from information_schema.column_privileges
      where grantee = 'anon' and table_schema = 'public' and privilege_type = 'SELECT' and table_name <> all ($1) order by 1`,
      [grants.map((g) => g.table_name)]);
    expect(byColumn.map((r) => r.table_name)).toEqual(['announcements', 'faqs', 'gallery_items', 'media_assets', 'site_content', 'testimonials']);
    const columnWrites = await rows(db, `select 1 from information_schema.column_privileges where grantee = 'anon' and table_schema = 'public' and privilege_type <> 'SELECT'`);
    expect(columnWrites).toEqual([]);
  });

  it('anon can call exactly one database function, and has no access to the private schema', async () => {
    const callable = await rows(db, `
      select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
        and p.prorettype <> 'trigger'::regtype -- trigger functions cannot be called directly
      order by 1`);
    expect(callable.map((r) => r.fn)).toEqual(['public.get_available_slots']);
    expect((await one(db, `select has_schema_privilege('anon', 'private', 'usage') as u`)).u).toBe(false);
  });

  it('anon is refused staff data outright', async () => {
    for (const table of ['customers', 'appointments', 'profiles', 'payments', 'payment_events', 'booking_holds', 'audit_log', 'appointment_intake_answers']) {
      await expect(asRole(db, 'anon', null, () => db.query(`select * from ${table} limit 1`)), table).rejects.toThrow(/permission denied/);
    }
  });

  it('every security-definer function in public pins its search_path', async () => {
    const loose = await rows(db, `
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(loose).toEqual([]);
  });
});
