import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { handleBookingRequest, type BookingDeps } from '../../supabase/functions/booking/handler';
import { asRole, createTestDb, one } from '../db/harness';
import { at, upcoming, MON, TUE, WED } from '../db/dates';

// Runs the Edge Function's request handler against the real database functions,
// with the service-role RPC call backed by the in-process test database.

let db: PGlite;
let swedish: string;
let A: string;
let visitor = 0;

function deps(overrides: Partial<BookingDeps> = {}): BookingDeps {
  const key = `visitor-${++visitor}`;
  return {
    allowedOrigins: ['https://site.example'],
    clientKey: async () => key,
    rpc: (fn, args) =>
      asRole(db, 'service_role', null, async () => {
        const names = Object.keys(args);
        const sql = `select * from ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
        try {
          const row: any = (await db.query(sql, Object.values(args))).rows[0];
          return { data: fn in row ? row[fn] : row, error: null };
        } catch (err: any) {
          return { data: null, error: { code: err.code, message: err.message, details: err.detail ?? null } };
        }
      }),
    ...overrides,
  };
}

function post(body: unknown, d = deps(), init: RequestInit = {}) {
  return handleBookingRequest(
    new Request('https://project.functions.example/booking', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://site.example' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    }),
    d,
  );
}

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`delete from appointments`);
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  A = (await one(db, `select id from therapists where sort_order = 1`)).id;
});

describe('booking endpoint', () => {
  it('creates a hold and returns only guest-safe fields', async () => {
    const start = at(upcoming(MON), '10:00');
    const res = await post({ action: 'create_hold', serviceId: swedish, startsAt: start.toISOString(), therapistId: A });
    expect(res.status).toBe(200);
    const { hold } = await res.json();
    expect(Object.keys(hold).sort()).toEqual(['endsAt', 'expiresAt', 'hasCustomer', 'startsAt', 'therapistId', 'token']);
    expect(hold.therapistId).toBe(A);
    expect(hold.hasCustomer).toBe(false);
    expect(new Date(hold.startsAt)).toEqual(start);
  });

  it('answers 409 with the reason when the slot is taken', async () => {
    const body = { action: 'create_hold', serviceId: swedish, startsAt: at(upcoming(TUE), '10:00').toISOString(), therapistId: A };
    expect((await post(body)).status).toBe(200);
    const res = await post(body);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'slot_unavailable', reason: 'slot_taken' });
  });

  it('runs the full guest sequence: hold, change time, add details, release', async () => {
    const date = upcoming(WED);
    const d = deps();
    const first = (await (await post({ action: 'create_hold', serviceId: swedish, startsAt: at(date, '10:00').toISOString() }, d)).json()).hold;
    const second = (
      await (await post({ action: 'create_hold', serviceId: swedish, startsAt: at(date, '11:00').toISOString(), therapistId: first.therapistId, replaceHoldToken: first.token }, d)).json()
    ).hold;
    expect((await one(db, `select status from booking_holds where hold_token = $1`, [first.token])).status).toBe('released');

    const attached = await post({ action: 'attach_customer', holdToken: second.token, fullName: 'Test Guest', email: 'guest@example.com', phone: '+2348000000000' }, d);
    expect(attached.status).toBe(200);
    expect((await attached.json()).hold.hasCustomer).toBe(true);

    expect(await (await post({ action: 'release_hold', holdToken: second.token }, d)).json()).toEqual({ released: true });
    expect(await (await post({ action: 'release_hold', holdToken: second.token }, d)).json()).toEqual({ released: false });

    const late = await post({ action: 'attach_customer', holdToken: second.token, fullName: 'Test Guest', email: 'guest@example.com', phone: '+2348000000000' }, d);
    expect(late.status).toBe(410);
    expect((await late.json()).error).toBe('hold_expired');
  });

  it('rejects malformed input before touching the booking functions', async () => {
    const cases: [unknown, string][] = [
      [{ action: 'drop_tables' }, 'action'],
      [{ action: 'create_hold', serviceId: 'not-a-uuid', startsAt: new Date().toISOString() }, 'serviceId'],
      [{ action: 'create_hold', serviceId: swedish, startsAt: 'tomorrow-ish' }, 'startsAt'],
      [{ action: 'create_hold', serviceId: swedish, startsAt: new Date().toISOString(), locationType: 'moon' }, 'locationType'],
      [{ action: 'attach_customer', holdToken: swedish, fullName: '', email: 'a@example.com', phone: '1234567' }, 'fullName'],
      [{ action: 'release_hold' }, 'holdToken'],
      ['{not json', 'body'],
      ['[1, 2]', 'body'],
    ];
    for (const [body, field] of cases) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_request', field });
    }
    expect((await post({ action: 'create_hold', padding: 'x'.repeat(5000) })).status).toBe(413);
    expect((await handleBookingRequest(new Request('https://project.functions.example/booking'), deps())).status).toBe(405);
  });

  it('reports invalid customer details as 422', async () => {
    const hold = (await (await post({ action: 'create_hold', serviceId: swedish, startsAt: at(upcoming(MON, 1), '10:00').toISOString() })).json()).hold;
    const res = await post({ action: 'attach_customer', holdToken: hold.token, fullName: 'Test Guest', email: 'nope', phone: '+2348000000000' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid_customer' });
  });

  it('rate-limits hold attempts per visitor', async () => {
    const d = deps();
    const other = deps();
    const body = { action: 'create_hold', serviceId: swedish, startsAt: at(upcoming(TUE, 1), '10:15').toISOString() }; // off-grid: never succeeds
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await post(body, d)).status);
    expect(statuses).toEqual([...Array(10).fill(409), 429]);
    expect((await post(body, other)).status).toBe(409); // a different visitor is unaffected
  });

  it('never leaks internal errors', async () => {
    const res = await post(
      { action: 'release_hold', holdToken: swedish },
      deps({
        rpc: async (fn) =>
          fn === 'consume_rate_limit'
            ? { data: true, error: null }
            : { data: null, error: { code: '42P01', message: 'relation "public.secret_table" does not exist' } },
      }),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"server_error"}');
  });

  it('only sends CORS headers to allowed origins', async () => {
    const preflight = await handleBookingRequest(
      new Request('https://project.functions.example/booking', { method: 'OPTIONS', headers: { origin: 'https://site.example' } }),
      deps(),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://site.example');

    const foreign = await post({ action: 'release_hold', holdToken: swedish }, deps(), {
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    });
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
  });
});
