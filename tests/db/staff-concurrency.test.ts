import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRealPostgres, type RealPostgres } from '../support/real-postgres';

// Phase 5a on a real PostgreSQL server: staff actions arriving at the same
// moment on separate connections.

let database: RealPostgres;
let pool: pg.Pool;

async function createStaff(email: string, role: 'owner' | 'admin' | 'therapist'): Promise<string> {
  const { rows } = await pool.query(`insert into auth.users (email) values ($1) returning id`, [email]);
  await pool.query(`update profiles set role = $2, is_active = true where id = $1`, [rows[0].id, role]);
  return rows[0].id;
}

/** Runs each statement as a signed-in user, all at the same moment, each on its own connection. */
async function raceAs(calls: { user: string; sql: string; params: unknown[] }[]) {
  const clients = await Promise.all(calls.map(() => pool.connect()));
  try {
    // Open every transaction and take every snapshot before any of them writes.
    await Promise.all(clients.map(async (c, i) => {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [calls[i].user]);
      await c.query('set local role authenticated');
    }));
    const results = await Promise.allSettled(clients.map(async (c, i) => {
      try {
        await c.query(calls[i].sql, calls[i].params);
        await c.query('commit');
      } catch (err) {
        await c.query('rollback');
        throw err;
      }
    }));
    return {
      won: results.filter((r) => r.status === 'fulfilled').length,
      lost: results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.message as string),
    };
  } finally {
    clients.forEach((c) => c.release());
  }
}

// Versions are read as text: a JS Date would drop PostgreSQL's microseconds.
// (The staff app receives them as JSON strings, which keep them.)
const profile = async (id: string) =>
  (await pool.query(`select *, updated_at::text as updated_at from profiles where id = $1`, [id])).rows[0];

beforeAll(async () => {
  database = await startRealPostgres(8);
  pool = database.pool;
}, 180_000);

afterAll(async () => {
  await database?.stop();
});

describe('the last owner (real PostgreSQL, separate connections)', () => {
  it('two owners demoting each other at the same moment: exactly one succeeds', async () => {
    const a = await createStaff('owner.a@example.com', 'owner');
    const b = await createStaff('owner.b@example.com', 'owner');
    const [pa, pb] = [await profile(a), await profile(b)];
    const { won, lost } = await raceAs([
      { user: a, sql: `select owner_set_staff_role($1, 'admin', 'handing over', $2)`, params: [b, pb.updated_at] },
      { user: b, sql: `select owner_set_staff_role($1, 'admin', 'handing over', $2)`, params: [a, pa.updated_at] },
    ]);
    expect(won, JSON.stringify(lost)).toBe(1);
    expect(lost).toHaveLength(1);
    // The loser either found itself no longer an owner, or was the last owner.
    expect(lost[0]).toMatch(/^(last_owner|not_authorized)$/);
    const { rows } = await pool.query(`select count(*)::int as n from profiles where role = 'owner' and is_active`);
    expect(rows[0].n).toBe(1);
  });

  it('two owners deactivating each other at the same moment: one active owner remains', async () => {
    const c = await createStaff('owner.c@example.com', 'owner');
    const { rows: owners } = await pool.query(`select id from profiles where role = 'owner' and is_active and id <> $1`, [c]);
    const other = owners[0].id;
    const [pc, po] = [await profile(c), await profile(other)];
    const { won, lost } = await raceAs([
      { user: c, sql: `select owner_set_staff_active($1, false, 'leaving', $2)`, params: [other, po.updated_at] },
      { user: other, sql: `select owner_set_staff_active($1, false, 'leaving', $2)`, params: [c, pc.updated_at] },
    ]);
    expect(won, JSON.stringify(lost)).toBe(1);
    const { rows } = await pool.query(`select count(*)::int as n from profiles where role = 'owner' and is_active`);
    expect(rows[0].n).toBe(1);
  });

  it('two edits of the same settings from the same version: one wins, the other is told it is stale', async () => {
    const owner = (await pool.query(`select id from profiles where role = 'owner' and is_active`)).rows[0].id;
    const admin = await createStaff('admin.x@example.com', 'admin');
    const { rows } = await pool.query(`select updated_at::text as updated_at from business_settings`);
    const { won, lost } = await raceAs([
      { user: owner, sql: `select staff_update_booking_rules($1, 'owner edit', null, 25)`, params: [rows[0].updated_at] },
      { user: admin, sql: `select staff_update_booking_rules($1, 'admin edit', null, 30)`, params: [rows[0].updated_at] },
    ]);
    expect(won, JSON.stringify(lost)).toBe(1);
    expect(lost).toEqual(['stale_record']);
    const audit = await pool.query(`select count(*)::int as n from audit_log where action = 'settings.booking_rules_changed'`);
    expect(audit.rows[0].n).toBe(1);
  });
});
