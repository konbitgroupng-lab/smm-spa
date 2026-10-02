import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GatewayError } from '../../supabase/functions/_shared/payments/gateway';
import { constantTimeEqual, PaystackAdapter } from '../../supabase/functions/_shared/payments/paystack';
import { FAKE_SECRET_KEY, startFakePaystack, type FakePaystack } from '../support/fake-paystack';

let paystack: FakePaystack;
let adapter: PaystackAdapter;

beforeAll(async () => {
  paystack = await startFakePaystack();
  adapter = new PaystackAdapter(FAKE_SECRET_KEY, { baseUrl: paystack.url });
});
afterAll(() => paystack.close());

const init = (reference: string, amountMinor = 4_000_000) =>
  adapter.initialize({ reference, amountMinor, currency: 'NGN', email: 'guest@example.com', callbackUrl: 'http://localhost:3000/booking/return' });

describe('Paystack adapter: configuration', () => {
  it('derives test or live mode from the key and rejects anything that is not a secret key', () => {
    expect(new PaystackAdapter('sk_test_abc').isTestMode).toBe(true);
    expect(new PaystackAdapter('sk_live_abc').isTestMode).toBe(false);
    expect(() => new PaystackAdapter('pk_test_abc')).toThrow(/secret key/);
    expect(() => new PaystackAdapter('')).toThrow(/secret key/);
  });

  it('never exposes the secret key on the object or in errors', async () => {
    expect(JSON.stringify(adapter)).not.toContain(FAKE_SECRET_KEY);
    expect(Object.values(adapter)).not.toContain(FAKE_SECRET_KEY);
    const wrongKey = new PaystackAdapter('sk_test_wrong_key', { baseUrl: paystack.url });
    const error = await wrongKey.verify('ANY-REFERENCE').catch((e) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(String(error.message)).not.toContain('sk_test');
  });
});

describe('Paystack adapter: initialization', () => {
  it('creates a hosted-checkout transaction with the amount in kobo', async () => {
    const result = await init('ADAPTER-INIT-1');
    expect(result.checkoutUrl).toMatch(/^https:\/\/checkout\.paystack\.com\//);
    expect(paystack.transactions.get('ADAPTER-INIT-1')).toMatchObject({
      amount: 4_000_000, currency: 'NGN', email: 'guest@example.com', callback_url: 'http://localhost:3000/booking/return', status: 'abandoned',
    });
  });

  it('raises GatewayError when Paystack refuses (duplicate reference) or is down', async () => {
    await init('ADAPTER-INIT-2');
    await expect(init('ADAPTER-INIT-2')).rejects.toBeInstanceOf(GatewayError);
    paystack.setOutage(true);
    await expect(init('ADAPTER-INIT-3')).rejects.toBeInstanceOf(GatewayError);
    paystack.setOutage(false);
    const unreachable = new PaystackAdapter(FAKE_SECRET_KEY, { baseUrl: 'http://127.0.0.1:9' });
    await expect(unreachable.verify('X')).rejects.toBeInstanceOf(GatewayError);
  });
});

describe('Paystack adapter: verification', () => {
  it('reports an unpaid (abandoned) transaction as pending', async () => {
    await init('ADAPTER-VERIFY-1');
    expect(await adapter.verify('ADAPTER-VERIFY-1')).toMatchObject({ status: 'pending', reference: 'ADAPTER-VERIFY-1' });
  });

  it('reports a paid transaction with amount, currency, channel and transaction id', async () => {
    await init('ADAPTER-VERIFY-2');
    const paid = paystack.pay('ADAPTER-VERIFY-2');
    expect(await adapter.verify('ADAPTER-VERIFY-2')).toEqual({
      reference: 'ADAPTER-VERIFY-2', status: 'success', amountMinor: 4_000_000, currency: 'NGN', paidAt: paid.paid_at,
      transactionId: String(paid.id), channel: 'card', failureReason: null,
    });
  });

  it('reports a declined transaction as failed with the gateway response', async () => {
    await init('ADAPTER-VERIFY-3');
    paystack.decline('ADAPTER-VERIFY-3', 'Insufficient Funds');
    expect(await adapter.verify('ADAPTER-VERIFY-3')).toMatchObject({ status: 'failed', failureReason: 'Insufficient Funds' });
  });

  it('reports an unknown reference as pending, never as paid', async () => {
    expect(await adapter.verify('ADAPTER-UNKNOWN')).toMatchObject({ status: 'pending', failureReason: 'not_found', amountMinor: null });
  });

  it('does not accept a success answer that is for a different reference', async () => {
    const swapping = new PaystackAdapter(FAKE_SECRET_KEY, {
      fetch: async () =>
        new Response(JSON.stringify({ status: true, data: { id: 1, status: 'success', reference: 'SOMEONE-ELSES', amount: 4_000_000, currency: 'NGN' } }), { status: 200 }),
    });
    expect((await swapping.verify('MINE')).status).toBe('pending');
  });

  it('raises GatewayError during an outage instead of guessing', async () => {
    paystack.setOutage(true);
    await expect(adapter.verify('ADAPTER-VERIFY-2')).rejects.toBeInstanceOf(GatewayError);
    paystack.setOutage(false);
  });
});

describe('Paystack adapter: webhook signature', () => {
  const body = JSON.stringify({ event: 'charge.success', data: { id: 7, reference: 'SIG-1', amount: 100, currency: 'NGN', status: 'success' } });
  const sign = (text: string, key = FAKE_SECRET_KEY) => createHmac('sha512', key).update(text).digest('hex');
  const check = (text: string, signature?: string) =>
    adapter.verifyWebhookSignature(text, new Headers(signature === undefined ? {} : { 'x-paystack-signature': signature }));

  it('accepts the HMAC-SHA512 of the raw body keyed with the secret key', async () => {
    expect(await check(body, sign(body))).toBe(true);
    expect(await check(body, sign(body).toUpperCase())).toBe(true);
  });

  it('rejects a missing, empty, malformed, truncated or wrong-key signature', async () => {
    expect(await check(body)).toBe(false);
    expect(await check(body, '')).toBe(false);
    expect(await check(body, 'not-hex')).toBe(false);
    expect(await check(body, sign(body).slice(0, 64))).toBe(false);
    expect(await check(body, sign(body, 'sk_test_another_key'))).toBe(false);
  });

  it('rejects a body that was changed after signing, even by whitespace', async () => {
    const signature = sign(body);
    expect(await check(body.replace('"amount":100', '"amount":1'), signature)).toBe(false);
    expect(await check(`${body} `, signature)).toBe(false);
  });

  it('compares signatures in constant time regardless of length', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([]), new Uint8Array([0]))).toBe(false);
  });
});

describe('Paystack adapter: webhook parsing', () => {
  it('recognises charge.success and keeps no card or customer data', () => {
    const event = adapter.parseWebhook(
      JSON.stringify({
        event: 'charge.success',
        data: { id: 99, reference: 'PARSE-1', amount: 4_000_000, currency: 'NGN', status: 'success', channel: 'card', domain: 'test',
          customer: { email: 'guest@example.com' }, authorization: { authorization_code: 'AUTH_secret', last4: '4081', bin: '408408' } },
      }),
    );
    expect(event).toMatchObject({ kind: 'charge_success', eventType: 'charge.success', eventId: 'charge.success:99', reference: 'PARSE-1' });
    const stored = JSON.stringify(event.summary);
    for (const sensitive of ['AUTH_secret', '4081', '408408', 'guest@example.com']) expect(stored).not.toContain(sensitive);
  });

  it.each([
    ['refund.pending', 'pending'],
    ['refund.processing', 'processing'],
    ['refund.processed', 'processed'],
    ['refund.failed', 'failed'],
  ])('recognises Paystack refund event %s', (eventType, status) => {
    const event = adapter.parseWebhook(
      JSON.stringify({ event: eventType, data: { status, transaction_reference: 'PARSE-2', refund_reference: 'RF-9', amount: '1500000', currency: 'NGN', merchant_note: 'Slot unavailable' } }),
    );
    expect(event).toMatchObject({
      kind: 'refund', eventId: `${eventType}:RF-9`,
      refund: { transactionReference: 'PARSE-2', refundReference: 'RF-9', status, amountMinor: 1_500_000, reason: 'Slot unavailable' },
    });
  });

  it('ignores other documented events and rejects malformed bodies', () => {
    expect(adapter.parseWebhook(JSON.stringify({ event: 'transfer.success', data: { id: 5 } }))).toMatchObject({ kind: 'ignored', eventId: 'transfer.success:5' });
    expect(() => adapter.parseWebhook('{"event":"charge.success"}')).toThrow();
    expect(() => adapter.parseWebhook('{"event":"charge.success","data":{}}')).toThrow();
    expect(() => adapter.parseWebhook('not json')).toThrow();
  });
});
