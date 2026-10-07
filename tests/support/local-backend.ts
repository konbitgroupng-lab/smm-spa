import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PGlite } from '@electric-sql/pglite';
import { handleBookingRequest } from '../../supabase/functions/booking/handler';
import { handleDemoCheckoutRequest } from '../../supabase/functions/demo-checkout/handler';
import { MockPaymentGateway } from '../../supabase/functions/_shared/payments/mock';
import { handlePaymentsRequest } from '../../supabase/functions/payments/handler';
import { handleWebhookRequest } from '../../supabase/functions/paystack-webhook/handler';
import { asRole } from '../db/harness';
import { pgliteRpc } from './rpc';

// A stand-in for a Supabase project, for tests that run the frontend's own
// service modules over HTTP:
//   POST /functions/v1/<name>   the real Edge Function handlers (demo gateway)
//   POST /rest/v1/rpc/<fn>      database functions, run as the guest role (anon)
// Only what the booking and payment services use is implemented.

export async function startLocalBackend(db: PGlite, site: string): Promise<{ url: string; close(): Promise<void> }> {
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
  };

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString();
    const path = (req.url ?? '').split('?')[0];
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();

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

    if (path.startsWith('/rest/v1/rpc/') && req.method === 'POST') {
      const fn = path.slice('/rest/v1/rpc/'.length);
      if (!/^[a-z_]+$/.test(fn)) return res.writeHead(400, cors).end();
      const args = JSON.parse(body || '{}');
      const names = Object.keys(args).filter((n) => /^[a-z_]+$/.test(n));
      try {
        const result = await asRole(db, 'anon', null, () =>
          db.query(`select * from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`, names.map((n) => args[n])),
        );
        const rows = result.rows as any[];
        const scalar = result.fields.length === 1 && result.fields[0].name === fn;
        res.writeHead(200, { ...cors, 'content-type': 'application/json' });
        return res.end(JSON.stringify(fn === 'get_available_slots' ? rows : scalar ? rows[0]?.[fn] : rows[0]));
      } catch (err: any) {
        res.writeHead(err.code === '42501' ? 401 : 400, { ...cors, 'content-type': 'application/json' });
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
