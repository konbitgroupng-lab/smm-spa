import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

// A real PostgreSQL server with the migrations and demo seed applied, for tests
// that need several simultaneous connections.

const root = path.resolve(__dirname, '../..');

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

export interface RealPostgres {
  pool: pg.Pool;
  stop(): Promise<void>;
}

export async function startRealPostgres(maxConnections = 24): Promise<RealPostgres> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'smm-pg-'));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true, // the data directory is removed in stop(), with retries (see below)
    initdbFlags: ['--encoding=UTF8', '--locale=C'], // Windows would otherwise default to WIN1252
    onLog: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase('smm_test');

  const pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'smm_test', max: maxConnections });
  await pool.query(`alter database smm_test set search_path = public, extensions`);

  const setup = await pool.connect();
  try {
    await setup.query(`set search_path = public, extensions`);
    await setup.query(readFileSync(path.join(root, 'tests/db/supabase-shim.sql'), 'utf8'));
    const migrations = path.join(root, 'supabase/migrations');
    for (const file of readdirSync(migrations).sort()) {
      await setup.query(readFileSync(path.join(migrations, file), 'utf8'));
    }
    await setup.query(readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8'));
    await setup.query(`delete from appointments`);
  } finally {
    setup.release();
  }

  return {
    pool,
    async stop() {
      await pool.end();
      await server.stop();
      // Windows keeps the directory locked for a moment after the server exits.
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          rmSync(dataDir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    },
  };
}
