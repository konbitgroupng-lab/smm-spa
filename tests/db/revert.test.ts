import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { applyMigrations, asRole, createTestDb, one, rows } from './harness';

// Phase 6f: the rollback scripts in supabase/revert/ undo the Phase 6
// migrations exactly. A database rolled back from the full build must match
// one that never had them, keep its content, and accept them again.

const PHASE_5_LAST = '20261015000100';
const revertDir = path.resolve(__dirname, '../../supabase/revert');
const DOWN = ['20261016000200_content_functions.down.sql', '20261016000100_content_security.down.sql'];

async function rollBack(db: PGlite) {
  await db.exec('begin');
  for (const file of DOWN) await db.exec(readFileSync(path.join(revertDir, file), 'utf8'));
  await db.exec('commit');
}

/** Everything about the schema that decides who can do what. */
async function snapshot(db: PGlite) {
  return {
    policies: await rows(db, `
      select schemaname, tablename, policyname, cmd, roles::text, qual, with_check
        from pg_policies where schemaname in ('public', 'storage') order by 1, 2, 3`),
    tableGrants: await rows(db, `
      select table_schema, table_name, grantee, privilege_type from information_schema.role_table_grants
       where table_schema in ('public', 'private', 'storage') and grantee in ('anon', 'authenticated', 'service_role')
       order by 1, 2, 3, 4`),
    columnGrants: await rows(db, `
      select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
       where table_schema = 'public' and grantee in ('anon', 'authenticated')
       order by 1, 2, 3, 4`),
    columns: await rows(db, `
      select table_name, column_name, data_type, column_default, is_nullable from information_schema.columns
       where table_schema in ('public', 'private') order by 1, 2`),
    functions: await rows(db, `
      select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f,
             array_to_string(p.proacl, ',') as acl
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') order by 1`),
    triggers: await rows(db, `
      select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where not t.tgisinternal and n.nspname in ('public', 'storage') order by 1, 2`),
    personalColumns: await rows(db, `select entity_type, column_name from private.audit_personal_columns order by 1, 2`),
  };
}

describe('rolling back Phase 6', () => {
  it('leaves the schema exactly as at the end of Phase 5, keeps content, and can be applied again', async () => {
    const phase5 = await createTestDb({ seed: false, until: PHASE_5_LAST });
    const expected = await snapshot(phase5);
    await phase5.close();

    const full = await createTestDb({ seed: false });
    const withPhase6 = await snapshot(full);
    // The comparison is sensitive to Phase 6: each part differs before the rollback.
    for (const part of ['policies', 'columnGrants', 'columns', 'functions', 'triggers', 'personalColumns'] as const) {
      expect(withPhase6[part], part).not.toEqual(expected[part]);
    }
    await full.query(`insert into faqs (question, answer, sort_order, is_published) values ('Kept after rollback?', array['Yes.'], 1, true)`);
    await full.query(`insert into media_assets (bucket, path, alt_text, mime_type, size_bytes) values ('site-media', 'gallery/kept.jpg', 'kept', 'image/jpeg', 10)`);

    await rollBack(full);
    expect(await snapshot(full)).toEqual(expected);
    expect((await one(full, `select count(*)::int as n from faqs where question = 'Kept after rollback?'`)).n).toBe(1);
    expect((await one(full, `select count(*)::int as n from media_assets where path = 'gallery/kept.jpg'`)).n).toBe(1);

    // The Phase 1 rules are back: owner/admin could write directly again (proved via the policy, as the snapshot matches).
    const anonRead = await asRole(full, 'anon', null, () => rows(full, `select id, is_published from faqs`));
    expect(anonRead.length).toBe(1);

    // Applying the Phase 6 migrations again restores Phase 6 exactly.
    const reapplied = await applyMigrations(full, { after: PHASE_5_LAST });
    expect(reapplied).toEqual(['20261016000100_content_security.sql', '20261016000200_content_functions.sql']);
    expect(await snapshot(full)).toEqual(withPhase6);
    await full.close();
  });
});
