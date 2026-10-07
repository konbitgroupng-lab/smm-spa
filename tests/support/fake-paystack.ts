import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// A simulated Paystack for tests: the two API endpoints the adapter uses, with
// Paystack's response shapes, plus controls to "pay" or "decline" a transaction
// and to produce correctly signed webhook deliveries.
// No real Paystack credentials or network access are involved.

export const FAKE_SECRET_KEY = 'sk_test_simulated_0123456789abcdef';

interface Transaction {
  id: number;
  reference: string;
  amount: number;
  currency: string;
  email: string;
  status: 'abandoned' | 'pending' | 'success' | 'failed';
  paid_at: string | null;
  channel: string | null;
  gateway_response: string;
  callback_url: string | null;
}

export interface FakePaystack {
  url: string;
  transactions: Map<string, Transaction>;
  /** Requests received, e.g. "POST /transaction/initialize". */
  requests: string[];
  /** The guest completes checkout. Overrides simulate tampering or provider-side differences. */
  pay(reference: string, overrides?: Partial<Pick<Transaction, 'amount' | 'currency' | 'channel'>>): Transaction;
  decline(reference: string, reason?: string): Transaction;
  /** Payment started but not confirmed yet (e.g. a bank transfer). */
  setPending(reference: string): Transaction;
  /** While true every API call answers 503. */
  setOutage(down: boolean): void;
  /** A webhook delivery signed the way Paystack signs it. */
  webhook(event: string, data: Record<string, unknown>, options?: { secret?: string }): { body: string; headers: Record<string, string> };
  chargeSuccessWebhook(reference: string): { body: string; headers: Record<string, string> };
  close(): Promise<void>;
}

export async function startFakePaystack(secretKey = FAKE_SECRET_KEY): Promise<FakePaystack> {
  const transactions = new Map<string, Transaction>();
  const requests: string[] = [];
  let nextId = 4_000_000_001;
  let outage = false;

  const server = http.createServer(async (req, res) => {
    const send = (status: number, payload: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
    const path = (req.url ?? '').split('?')[0];
    requests.push(`${req.method} ${path}`);

    if (outage) return send(503, { status: false, message: 'Service unavailable' });
    if (req.headers.authorization !== `Bearer ${secretKey}`) return send(401, { status: false, message: 'Invalid key' });

    if (req.method === 'POST' && path === '/transaction/initialize') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (!body.email || !Number.isInteger(body.amount) || body.amount <= 0) return send(400, { status: false, message: 'Invalid amount or email' });
      if (transactions.has(body.reference)) return send(400, { status: false, message: 'Duplicate Transaction Reference' });
      const transaction: Transaction = {
        id: nextId++, reference: body.reference, amount: body.amount, currency: body.currency ?? 'NGN', email: body.email,
        status: 'abandoned', paid_at: null, channel: null, gateway_response: 'The transaction was not completed',
        callback_url: body.callback_url ?? null,
      };
      transactions.set(body.reference, transaction);
      const accessCode = `ac_${transaction.id}`;
      return send(200, {
        status: true,
        message: 'Authorization URL created',
        data: { authorization_url: `https://checkout.paystack.com/${accessCode}`, access_code: accessCode, reference: body.reference },
      });
    }

    if (req.method === 'GET' && path.startsWith('/transaction/verify/')) {
      const transaction = transactions.get(decodeURIComponent(path.slice('/transaction/verify/'.length)));
      if (!transaction) return send(400, { status: false, message: 'Transaction reference not found' });
      return send(200, {
        status: true,
        message: 'Verification successful',
        data: {
          id: transaction.id, domain: 'test', status: transaction.status, reference: transaction.reference,
          amount: transaction.amount, currency: transaction.currency, paid_at: transaction.paid_at,
          channel: transaction.channel, gateway_response: transaction.gateway_response,
          customer: { email: transaction.email },
          authorization: { authorization_code: 'AUTH_simulated', last4: '4081', bin: '408408' },
        },
      });
    }

    send(404, { status: false, message: 'Not found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const get = (reference: string) => {
    const transaction = transactions.get(reference);
    if (!transaction) throw new Error(`fake paystack: unknown reference ${reference}`);
    return transaction;
  };

  const fake: FakePaystack = {
    url,
    transactions,
    requests,
    pay(reference, overrides = {}) {
      const transaction = get(reference);
      Object.assign(transaction, { status: 'success', paid_at: new Date().toISOString(), channel: 'card', gateway_response: 'Successful' }, overrides);
      return transaction;
    },
    decline(reference, reason = 'Declined') {
      const transaction = get(reference);
      Object.assign(transaction, { status: 'failed', gateway_response: reason, channel: 'card' });
      return transaction;
    },
    setPending(reference) {
      const transaction = get(reference);
      Object.assign(transaction, { status: 'pending', gateway_response: 'Transaction ongoing', channel: 'bank_transfer' });
      return transaction;
    },
    setOutage(down) {
      outage = down;
    },
    webhook(event, data, options = {}) {
      const body = JSON.stringify({ event, data });
      const signature = createHmac('sha512', options.secret ?? secretKey).update(body).digest('hex');
      return { body, headers: { 'content-type': 'application/json', 'x-paystack-signature': signature } };
    },
    chargeSuccessWebhook(reference) {
      const t = get(reference);
      return fake.webhook('charge.success', {
        id: t.id, domain: 'test', status: 'success', reference: t.reference, amount: t.amount, currency: t.currency,
        paid_at: t.paid_at, channel: t.channel, gateway_response: t.gateway_response,
        customer: { email: t.email }, authorization: { authorization_code: 'AUTH_simulated', last4: '4081' },
      });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  return fake;
}
