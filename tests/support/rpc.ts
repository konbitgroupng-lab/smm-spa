import type { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import type { Rpc } from '../../supabase/functions/_shared/http';
import { asRole } from '../db/harness';

// Stand-ins for "supabase.rpc() with the service-role key": call a database
// function by name with named arguments and return { data, error } the way
// PostgREST does. Used to run the Edge Function handlers against a test database.

const call = (fn: string, args: Record<string, unknown>) => {
  const names = Object.keys(args);
  return {
    sql: `select * from ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`,
    params: Object.values(args).map((v) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v)),
  };
};
// A scalar or jsonb result comes back as one column named after the function.
const unwrap = (fn: string, row: any) => (row && fn in row ? row[fn] : row);
const toError = (err: any) => ({ code: err.code, message: err.message, details: err.detail ?? null });

/** Single-connection, in-process database. */
export function pgliteRpc(db: PGlite): Rpc {
  return (fn, args) =>
    asRole(db, 'service_role', null, async () => {
      const { sql, params } = call(fn, args);
      try {
        return { data: unwrap(fn, (await db.query(sql, params)).rows[0]), error: null };
      } catch (err) {
        return { data: null, error: toError(err) };
      }
    });
}

/** Real PostgreSQL: every call takes its own pooled connection, as separate API requests would. */
export function pgRpc(pool: pg.Pool): Rpc {
  return async (fn, args) => {
    const { sql, params } = call(fn, args);
    try {
      return { data: unwrap(fn, (await pool.query(sql, params)).rows[0]), error: null };
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  };
}
