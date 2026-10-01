import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { at, upcoming, MON, THU, TUE, WED } from './dates';

// The other database tests run on a single connection. These run the same
// migrations on a real PostgreSQL server and fire many requests at once from
// separate connections, to prove that simultaneous guests cannot double-book.

const root = path.resolve(__dirname, '../..');
const CLIENTS = 24;

let server: EmbeddedPostgres;
let pool: pg.Pool;
let dataDir: string;
let swedish: string;
let therapists: string[];
let customerId: string;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/** Runs every query at the same moment, each on its own connection. */
async function race(queries: { sql: string; params: unknown[] }[]) {
  const clients = await Promise.all(queries.map(() => pool.connect()));
  try {
    const results = await Promise.allSettled(queries.map((q, i) => clients[i].query(q.sql, q.params)));
    return {
      won: results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<pg.QueryResult>).value.rows[0]),
      lost: results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.message as string),
    };
  } finally {
    clients.forEach((c) => c.release());
  }
}

const requestHold = (startsAt: Date, therapistId: string | null) => ({
  sql: `select * from request_booking_hold($1, $2, $3)`,
  params: [swedish, startsAt.toISOString(), therapistId],
});

async function overlappingPairs(): Promise<number> {
  const { rows } = await pool.query(`
    with live as (
      select therapist_id, tstzrange(starts_at, blocked_until) as r, 'hold-' || id as ref
      from booking_holds where status = 'active' and expires_at > now()
      union all
      select therapist_id, tstzrange(starts_at, blocked_until), 'appt-' || id
      from appointments where status in ('pending_payment', 'confirmed', 'completed')
    )
    select count(*)::int as n from live a join live b on a.therapist_id = b.therapist_id and a.ref < b.ref and a.r && b.r`);
  return rows[0].n;
}

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'smm-pg-'));
  const port = await freePort();
  server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'], // Windows would otherwise default to WIN1252
    onLog: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase('smm_test');

  pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'smm_test', max: CLIENTS });
  await pool.query(`alter database smm_test set search_path = public, extensions`);

  const setup = await pool.connect();
  try {
    await setup.query(`set search_path = public, extensions`);
    await setup.query(readFileSync(path.join(__dirname, 'supabase-shim.sql'), 'utf8'));
    const migrations = path.join(root, 'supabase/migrations');
    for (const file of readdirSync(migrations).sort()) {
      await setup.query(readFileSync(path.join(migrations, file), 'utf8'));
    }
    await setup.query(readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8'));
    await setup.query(`delete from appointments`);
  } finally {
    setup.release();
  }

  swedish = (await pool.query(`select id from services where slug = 'swedish'`)).rows[0].id;
  therapists = (await pool.query(`select id from therapists order by sort_order`)).rows.map((r) => r.id);
  customerId = (await pool.query(`select id from customers limit 1`)).rows[0].id;
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

describe('simultaneous booking attempts (real PostgreSQL, separate connections)', () => {
  it(`gives one slot to exactly one of ${CLIENTS} guests`, async () => {
    const start = at(upcoming(MON), '10:00');
    const { won, lost } = await race(Array.from({ length: CLIENTS }, () => requestHold(start, therapists[0])));
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(CLIENTS - 1);
    expect(new Set(lost)).toEqual(new Set(['slot_unavailable']));
  });

  it('spreads "any therapist" requests across all four therapists, then refuses the rest without deadlocks', async () => {
    const start = at(upcoming(TUE), '10:00');
    const { won, lost } = await race(Array.from({ length: CLIENTS }, () => requestHold(start, null)));
    expect(won).toHaveLength(4);
    expect(new Set(won.map((h) => h.therapist_id))).toEqual(new Set(therapists));
    expect(new Set(lost)).toEqual(new Set(['slot_unavailable']));
  });

  it('never leaves overlapping reservations when guests race for neighbouring times', async () => {
    const date = upcoming(WED);
    const times = ['10:00', '10:30', '11:00', '11:30', '12:00', '14:00', '14:30', '15:00'];
    const queries = Array.from({ length: CLIENTS * 2 }, (_, i) =>
      requestHold(at(date, times[i % times.length]), i % 3 === 0 ? null : therapists[i % 2]),
    );
    const { won, lost } = await race(queries.slice(0, CLIENTS));
    const second = await race(queries.slice(CLIENTS));
    expect(won.length + second.won.length).toBeGreaterThan(0);
    expect(new Set([...lost, ...second.lost])).toEqual(new Set(['slot_unavailable']));
    expect(await overlappingPairs()).toBe(0);
  });

  it('lets only one writer win when holds and direct appointment inserts race for the same slot', async () => {
    const start = at(upcoming(THU), '10:00');
    const appointment = {
      sql: `insert into appointments (customer_id, service_id, therapist_id, starts_at, ends_at, blocked_until, status, price_minor)
            values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '60 minutes', $4::timestamptz + interval '75 minutes', 'confirmed', 4000000)
            returning id`,
      params: [customerId, swedish, therapists[0], start.toISOString()],
    };
    const queries = Array.from({ length: CLIENTS }, (_, i) => (i % 2 === 0 ? appointment : requestHold(start, therapists[0])));
    const { won } = await race(queries);
    expect(won).toHaveLength(1);
    expect(await overlappingPairs()).toBe(0);
  });
});
