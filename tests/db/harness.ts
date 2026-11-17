import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const root = path.resolve(__dirname, '../..');
const migrationsDir = path.join(root, 'supabase/migrations');

export type Role = 'anon' | 'authenticated' | 'service_role';

/**
 * Builds a fresh in-memory Postgres with the real migrations applied on top of
 * a small Supabase shim (auth schema, API roles, storage tables).
 */
export async function createTestDb({ seed = true, until }: { seed?: boolean; until?: string } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec('set search_path = public, extensions;');
  await db.exec(readFileSync(path.join(__dirname, 'supabase-shim.sql'), 'utf8'));
  await applyMigrations(db, { until });
  if (seed) {
    await db.exec(readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8'));
  }
  return db;
}

/** Applies the migrations in order: all, those up to `until` (a version prefix), or those after `after`. */
export async function applyMigrations(db: PGlite, { until, after }: { until?: string; after?: string } = {}): Promise<string[]> {
  const files = readdirSync(migrationsDir).sort()
    .filter((f) => (until === undefined || f.slice(0, 14) <= until) && (after === undefined || f.slice(0, 14) > after));
  for (const file of files) {
    await db.exec(readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  return files;
}

/** Runs `fn` as a Supabase API role, optionally as a specific signed-in user. */
export async function asRole<T>(
  db: PGlite,
  role: Role,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

export async function rows<T = Record<string, any>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function one<T = Record<string, any>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const result = await rows<T>(db, sql, params);
  if (result.length !== 1) throw new Error(`Expected 1 row, got ${result.length}: ${sql}`);
  return result[0];
}

/** Creates an Auth user (which creates the profile via trigger) and sets the staff role. */
export async function createStaff(
  db: PGlite,
  email: string,
  role: 'owner' | 'admin' | 'therapist',
  { active = true } = {},
): Promise<string> {
  const { id } = await one<{ id: string }>(db, `insert into auth.users (email) values ($1) returning id`, [email]);
  await db.query(`update public.profiles set role = $2, is_active = $3 where id = $1`, [id, role, active]);
  return id;
}
