import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PGlite } from '@electric-sql/pglite';
import { handleBookingRequest } from '../../supabase/functions/booking/handler';
import { handleDemoCheckoutRequest } from '../../supabase/functions/demo-checkout/handler';
import { MockPaymentGateway } from '../../supabase/functions/_shared/payments/mock';
import { handlePaymentsRequest } from '../../supabase/functions/payments/handler';
import { handleWebhookRequest } from '../../supabase/functions/paystack-webhook/handler';
import { handleInviteRequest } from '../../supabase/functions/staff-invite/handler';
import { asRole } from '../db/harness';
import { pgliteRpc } from './rpc';

// A stand-in for a Supabase project, for tests that run the frontend's own
// service modules over HTTP:
//   POST /functions/v1/<name>   the real Edge Function handlers (demo gateway)
//   POST /rest/v1/rpc/<fn>      database functions, run as the guest role (anon),
//                               or as the signed-in user when a token from /auth/v1 is sent
//   /auth/v1/...                a minimal stand-in for Supabase Auth (password sign-in,
//                               sign-out, password change), when `staffPassword` is given;
//                               its "invitation" (staff-invite) creates the Auth user directly
// Only what the booking, payment and staff services use is implemented.
// Test-only: its tokens are unsigned and trusted as-is.

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** The claims of a token issued by this backend, or null for the anon key. */
function tokenClaims(authorization: string | undefined): { sub: string; role: string; aal: string } | null {
  const token = authorization?.replace(/^Bearer /, '') ?? '';
  const [, payload] = token.split('.');
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return claims.role === 'authenticated' && typeof claims.sub === 'string' ? claims : null;
  } catch {
    return null;
  }
}

/** A public database function called as the request's user, answered as PostgREST would. */
async function callAs(db: PGlite, authorization: string | undefined, fn: string, args: Record<string, unknown>) {
  if (!/^[a-z_]+$/.test(fn)) return { data: null, error: { message: 'invalid function' } };
  const names = Object.keys(args).filter((n) => /^[a-z_]+$/.test(n));
  try {
    const result = await asRequester(db, authorization, () =>
      db.query(`select * from public.${fn}(${names.map((n, i) => ` => $${i + 1}`).join(', ')})`, names.map((n) => (args as any)[n])),
    );
    const rows = result.rows as any[];
    const scalar = result.fields.length === 1 && result.fields[0].name === fn;
    return { data: scalar ? rows[0]?.[fn] : rows[0], error: null };
  } catch (err: any) {
    return { data: null, error: { code: err.code, message: err.message, details: err.detail ?? null } };
  }
}

/** Runs `fn` as the request's user: signed in (with its token's claims) or anon. */
async function asRequester<T>(db: PGlite, authorization: string | undefined, fn: () => Promise<T>): Promise<T> {
  const claims = tokenClaims(authorization);
  if (!claims) return asRole(db, 'anon', null, fn);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  try {
    return await asRole(db, 'authenticated', claims.sub, fn);
  } finally {
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

export async function startLocalBackend(
  db: PGlite,
  site: string,
  { staffPassword }: { staffPassword?: string } = {},
): Promise<{ url: string; close(): Promise<void> }> {
  const rpc = pgliteRpc(db);
  const gateway = new MockPaymentGateway({ rpc, webhookSecret: 'local-backend-demo-secret' });
  let visitor = 0;
  const common = { rpc, allowedOrigins: [site], clientKey: async () => `local-${++visitor}` };
  const functions: Record<string, (req: Request) => Promise<Response>> = {
    booking: (req) => handleBookingRequest(req, common),
    payments: (req) => handlePaymentsRequest(req, { ...common, gateway }),
    'paystack-webhook': (req) => handleWebhookRequest(req, { rpc, gateway }),
    'demo-checkout': (req) =>
      handleDemoCheckoutRequest(req, {
        ...common,
        gateway,
        deliverWebhook: async ({ body, headers }) => (await functions['paystack-webhook'](new Request('http://local/webhook', { method: 'POST', headers, body }))).status,
      }),
    'staff-invite': (req) =>
      handleInviteRequest(req, {
        rpc,
        allowedOrigins: [site],
        rpcAsCaller: (token, fn, args) => callAs(db, `Bearer ${token}`, fn, args),
        invite: async (email, fullName) => {
          const existing = await db.query(`select 1 from auth.users where lower(email) = lower($1)`, [email]);
          if (existing.rows.length) return { error: 'already_registered' as const };
          const { rows } = await db.query<{ id: string }>(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
            [email, JSON.stringify({ full_name: fullName })]);
          return { userId: rows[0].id };
        },
      }),
  };

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString();
    const path = (req.url ?? '').split('?')[0];
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { ...cors, 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' });
      return res.end(JSON.stringify(value));
    };

    if (path.startsWith('/auth/v1/') && staffPassword) {
      const user = async (id: string) => (await db.query<{ id: string; email: string }>(`select id, email from auth.users where id = $1`, [id])).rows[0];
      const reply = (u: { id: string; email: string }) => ({
        id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
        app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
      });
      if (path === '/auth/v1/token' && req.method === 'POST') {
        const { email, password } = JSON.parse(body || '{}');
        const found = (await db.query<{ id: string; email: string }>(`select id, email from auth.users where email = $1`, [email])).rows[0];
        if (!found || password !== staffPassword) {
          return json(400, { code: 'invalid_credentials', msg: 'Invalid login credentials' });
        }
        const now = Math.floor(Date.now() / 1000);
        const access_token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: found.id, role: 'authenticated', aal: 'aal1', exp: now + 3600, email: found.email })}.unsigned`;
        return json(200, { access_token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: `refresh-${found.id}`, user: reply(found) });
      }
      const claims = tokenClaims(req.headers.authorization);
      if (path === '/auth/v1/logout') return res.writeHead(204, cors).end();
      if (path === '/auth/v1/user' && claims) {
        const u = await user(claims.sub);
        if (req.method === 'PUT' && JSON.parse(body || '{}').password === staffPassword) {
          return json(422, { code: 'same_password', msg: 'New password should be different from the old password.' });
        }
        return json(200, reply(u));
      }
      return json(401, { code: 'no_authorization', msg: 'This endpoint requires a valid Bearer token' });
    }

    if (path.startsWith('/functions/v1/')) {
      const handler = functions[path.slice('/functions/v1/'.length)];
      if (!handler) return res.writeHead(404, cors).end();
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
      headers.set('origin', site);
      const response = await handler(new Request(`http://local${path}`, { method: req.method, headers, body: req.method === 'GET' ? undefined : body }));
      res.writeHead(response.status, { ...cors, 'content-type': response.headers.get('content-type') ?? 'application/json' });
      return res.end(await response.text());
    }

    // Table reads, as PostgREST serves them to the guest role: select=<columns>,
    // <column>=eq.<value>, <column>=in.(a,b), order=<column>.asc|desc.
    if (path.startsWith('/rest/v1/') && !path.startsWith('/rest/v1/rpc/') && req.method === 'GET') {
      const table = path.slice('/rest/v1/'.length);
      const query = new URL(req.url ?? '', 'http://local').searchParams;
      const ident = /^[a-z_]+$/;
      const columns = (query.get('select') ?? '*').split(',');
      if (!ident.test(table) || !columns.every((c) => c === '*' || ident.test(c))) return res.writeHead(400, cors).end();
      const where: string[] = [];
      const params: unknown[] = [];
      let order = '';
      for (const [key, value] of query) {
        if (key === 'select') continue;
        if (key === 'order') {
          const [column, direction = 'asc'] = value.split('.');
          if (!ident.test(column)) return res.writeHead(400, cors).end();
          order = ` order by ${column} ${direction === 'desc' ? 'desc' : 'asc'}`;
        } else if (ident.test(key) && value.startsWith('eq.')) {
          params.push(value.slice(3));
          where.push(`${key}::text = $${params.length}`);
        } else if (ident.test(key) && value.startsWith('in.(')) {
          params.push(value.slice(4, -1).split(',').map((v) => v.replace(/^"|"$/g, '')));
          where.push(`${key}::text = any($${params.length})`);
        } else {
          return res.writeHead(400, cors).end();
        }
      }
      try {
        const result = await asRole(db, 'anon', null, () =>
          db.query(`select ${columns.join(', ')} from public.${table}${where.length ? ` where ${where.join(' and ')}` : ''}${order}`, params),
        );
        const rows = result.rows as any[];
        const single = (req.headers.accept ?? '').includes('vnd.pgrst.object');
        if (single && rows.length !== 1) {
          res.writeHead(406, { ...cors, 'content-type': 'application/json' });
          return res.end(JSON.stringify({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null }));
        }
        res.writeHead(200, { ...cors, 'content-type': 'application/json' });
        return res.end(JSON.stringify(single ? rows[0] : rows));
      } catch (err: any) {
        res.writeHead(err.code === '42501' ? 401 : 400, { ...cors, 'content-type': 'application/json' });
        return res.end(JSON.stringify({ code: err.code, message: err.message, details: err.detail ?? null, hint: null }));
      }
    }

    if (path.startsWith('/rest/v1/rpc/') && req.method === 'POST') {
      const fn = path.slice('/rest/v1/rpc/'.length);
      if (!/^[a-z_]+$/.test(fn)) return res.writeHead(400, cors).end();
      const args = JSON.parse(body || '{}');
      const names = Object.keys(args).filter((n) => /^[a-z_]+$/.test(n));
      try {
        const result = await asRequester(db, req.headers.authorization, () =>
          db.query(`select * from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`, names.map((n) => args[n])),
        );
        const rows = result.rows as any[];
        const scalar = result.fields.length === 1 && result.fields[0].name === fn;
        // As PostgREST: set-returning functions give an array, others one value or object.
        const returnsSet = (await db.query<{ s: boolean }>(
          `select bool_or(p.proretset) as s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn],
        )).rows[0]?.s;
        res.writeHead(200, { ...cors, 'content-type': 'application/json' });
        return res.end(JSON.stringify(returnsSet ? rows : scalar ? rows[0]?.[fn] : rows[0]));
      } catch (err: any) {
        const status = err.code === '42501' ? (tokenClaims(req.headers.authorization) ? 403 : 401) : 400;
        res.writeHead(status, { ...cors, 'content-type': 'application/json' });
        return res.end(JSON.stringify({ code: err.code, message: err.message, details: err.detail ?? null, hint: null }));
      }
    }

    res.writeHead(404, cors).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
