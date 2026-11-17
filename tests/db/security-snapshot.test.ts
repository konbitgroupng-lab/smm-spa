import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createStaff, createTestDb, one, rows } from './harness';

// Phase 5e security snapshot. Pins down exactly what each API role can reach,
// so any new function, grant or table must be reviewed before these tests pass.

let db: PGlite;
let therapist: string;
let newAccount: string;

beforeAll(async () => {
  db = await createTestDb();
  therapist = await createStaff(db, 'therapist@example.com', 'therapist');
  newAccount = (await one(db, `insert into auth.users (email) values ('new@example.com') returning id`)).id;
});

const callable = (role: string) => rows(db, `
  select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and has_function_privilege($1, p.oid, 'execute') and p.prorettype <> 'trigger'::regtype
  order by 1`, [role]).then((r) => r.map((x) => x.f));

const STAFF_FUNCTIONS = [
  'owner_link_therapist', 'owner_record_invitation', 'owner_record_refund', 'owner_set_staff_active', 'owner_set_staff_role',
  'owner_staff_list', 'owner_update_payment_settings', 'staff_add_blackout', 'staff_add_time_off', 'staff_appointment_detail',
  'staff_appointments', 'staff_audit_log', 'staff_booking_options', 'staff_cancel_appointment', 'staff_catalogue',
  'staff_create_booking', 'staff_create_customer', 'staff_customer_detail', 'staff_customer_directory', 'staff_dashboard',
  'staff_payment_detail', 'staff_payments', 'staff_remove_blackout', 'staff_remove_time_off', 'staff_reschedule_appointment',
  'staff_save_service', 'staff_save_therapist', 'staff_save_zone', 'staff_schedule_conflicts', 'staff_schedule_overview',
  'staff_set_appointment_status', 'staff_set_business_hours', 'staff_set_package_items', 'staff_set_settlement',
  'staff_set_therapist_services', 'staff_set_therapist_week', 'staff_settings', 'staff_update_booking_details',
  'staff_update_booking_rules', 'staff_update_customer', 'staff_update_own_profile', 'staff_whoami', 'therapist_agenda',
  // Phase 6a: website content.
  'staff_content', 'staff_delete_content', 'staff_register_media', 'staff_remove_media', 'staff_reorder_content',
  'staff_save_announcement', 'staff_save_faq', 'staff_save_gallery_item', 'staff_save_site_content', 'staff_save_testimonial',
  'staff_set_content_published', 'staff_update_media',
  // Guest bank transfers: the transfer list, confirming one, the owner's account details.
  'owner_update_transfer_settings', 'staff_confirm_transfer', 'staff_transfers',
];
const SERVER_ONLY = [
  'attach_customer_to_hold', 'begin_hold_payment', 'consume_rate_limit', 'create_booking_hold', 'finish_payment_event',
  'get_payment_outcome', 'log_payment_event', 'mark_payment_init_failed', 'mock_provider_complete', 'mock_provider_get',
  'mock_provider_initialize', 'record_payment_result', 'record_refund_event', 'release_booking_hold',
  'release_expired_booking_holds', 'request_booking_hold', 'run_booking_maintenance', 'set_payment_checkout',
  // Guest bank transfers.
  'get_transfer_booking', 'request_transfer_booking',
].sort();

describe('what each role can call', () => {
  it('guests: only the availability search', async () => {
    expect(await callable('anon')).toEqual(['public.get_available_slots']);
  });

  it('signed-in users: the staff functions, the availability search and the policy helpers, nothing else', async () => {
    expect(await callable('authenticated')).toEqual([
      'private.is_admin', 'private.is_own_appointment', 'private.is_owner', 'private.staff_role', 'private.therapist_id',
      'public.get_available_slots', ...STAFF_FUNCTIONS.map((f) => `public.${f}`),
    ].sort());
  });

  it('booking and payment server functions: server-side code only', async () => {
    const serverOnly = (await rows(db, `
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('service_role', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
      order by 1`)).map((r) => r.proname);
    expect(serverOnly).toEqual(SERVER_ONLY);
  });

  it('no public function keeps the default "anyone may execute" grant', async () => {
    const open = await rows(db, `
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proacl is null or array_to_string(p.proacl, ',') ~ '(^|,)=X')`);
    expect(open).toEqual([]);
  });

  it('every staff function checks the caller\'s role itself (not only its grant)', async () => {
    const unchecked = await rows(db, `
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any ($1)
        and p.proname not in ('staff_whoami')
        and p.prosrc !~ 'private\\.(require_staff|begin_schedule_change)\\(' and p.prosrc !~ 'private\\.therapist_id\\(\\)'`, [STAFF_FUNCTIONS]);
    expect(unchecked).toEqual([]);
  });

  it('an account with no staff access is refused by every staff read', async () => {
    for (const sql of [
      `select staff_dashboard()`, `select * from staff_appointments(now(), now() + interval '1 day')`, `select * from staff_payments('all')`,
      `select * from staff_audit_log()`, `select staff_settings()`, `select staff_catalogue()`, `select staff_schedule_overview()`,
      `select * from staff_customer_directory()`, `select owner_staff_list()`, `select * from therapist_agenda(now(), now() + interval '1 day')`,
      `select staff_content()`,
    ]) {
      await expect(asRole(db, 'authenticated', newAccount, () => db.query(sql)), sql).rejects.toThrow(/not_authorized/);
    }
  });
});

describe('tables', () => {
  it('row level security is on for every table in the public schema', async () => {
    expect(await rows(db, `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)).toEqual([]);
  });

  it('signed-in users can write directly only to the two intake tables, which Phase 6d closes (owner/admin by policy)', async () => {
    const writable = (await rows(db, `select distinct table_name from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
      order by 1`)).map((r) => r.table_name);
    // Phase 6a took the six website content tables off this list.
    expect(writable).toEqual(['appointment_intake_answers', 'intake_questions']);
    expect(await rows(db, `select table_name, column_name from information_schema.column_privileges
      where grantee in ('authenticated', 'anon', 'PUBLIC') and table_schema = 'public' and privilege_type <> 'SELECT'
        and table_name not in ('appointment_intake_answers', 'intake_questions')`)).toEqual([]);
    // Their policies admit owner/admin only.
    for (const table of writable) {
      const changed = await asRole(db, 'authenticated', therapist, async () => (await db.query(`update ${table} set ${({ appointment_intake_answers: 'answer = answer' } as Record<string, string>)[table] ?? 'created_at = created_at'}`)).affectedRows);
      expect(changed, table).toBe(0);
    }
    expect(await rows(db, `select table_name from information_schema.role_table_grants
      where grantee in ('PUBLIC', 'anon') and table_schema = 'public' and privilege_type <> 'SELECT'`)).toEqual([]);
  });

  it('no column holds a secret, password or provider key', async () => {
    const suspicious = await rows(db, `select table_schema || '.' || table_name || '.' || column_name as c from information_schema.columns
      where table_schema in ('public', 'private') and column_name ~* '(secret|password|api_?key|private_key|access_token|refresh_token)'`);
    expect(suspicious).toEqual([]);
  });
});
