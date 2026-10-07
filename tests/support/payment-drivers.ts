import type { PGlite } from '@electric-sql/pglite';
import type { PaymentGateway } from '../../supabase/functions/_shared/payments/gateway';
import { MockPaymentGateway } from '../../supabase/functions/_shared/payments/mock';
import { PaystackAdapter } from '../../supabase/functions/_shared/payments/paystack';
import { FAKE_SECRET_KEY, startFakePaystack, type FakePaystack } from './fake-paystack';
import { pgliteRpc } from './rpc';

// One "test driver" per provider, so the same scenarios can run against the
// Paystack adapter (talking to a simulated Paystack over HTTP) and against the
// demo gateway (talking to its ledger in the database). A driver acts the part
// of the provider and the guest; it never touches payments or appointments.

export interface Delivery {
  body: string;
  headers: Record<string, string>;
}

export interface PaymentDriver {
  label: string;
  gateway: PaymentGateway;
  /** The guest pays successfully. `amountMinor` simulates the provider reporting a different amount. */
  pay(reference: string, amountMinor?: number): Promise<void>;
  decline(reference: string): Promise<void>;
  setPending(reference: string): Promise<void>;
  /** The provider's signed charge.success notification. */
  successEvent(reference: string): Promise<Delivery>;
  /** A provider-signed event of any kind. */
  event(name: string, data: Record<string, unknown>): Promise<Delivery>;
  /** The same event, signed with the wrong key. */
  forgedEvent(reference: string): Promise<Delivery>;
  close(): Promise<void>;
}

export async function paystackDriver(): Promise<PaymentDriver> {
  const paystack: FakePaystack = await startFakePaystack();
  const gateway = new PaystackAdapter(FAKE_SECRET_KEY, { baseUrl: paystack.url });
  const data = (reference: string) => {
    const t = paystack.transactions.get(reference)!;
    return { id: t.id, domain: 'test', status: 'success', reference, amount: t.amount, currency: t.currency, paid_at: t.paid_at, channel: t.channel };
  };
  return {
    label: 'Paystack adapter (simulated Paystack API)',
    gateway,
    async pay(reference, amountMinor) {
      paystack.pay(reference, amountMinor === undefined ? {} : { amount: amountMinor });
    },
    async decline(reference) {
      paystack.decline(reference);
    },
    async setPending(reference) {
      paystack.setPending(reference);
    },
    async successEvent(reference) {
      return paystack.chargeSuccessWebhook(reference);
    },
    async event(name, payload) {
      return paystack.webhook(name, payload);
    },
    async forgedEvent(reference) {
      return paystack.webhook('charge.success', data(reference), { secret: 'sk_test_forger' });
    },
    close: () => paystack.close(),
  };
}

export async function mockDriver(db: PGlite): Promise<PaymentDriver> {
  const rpc = pgliteRpc(db);
  const gateway = new MockPaymentGateway({ rpc, webhookSecret: 'test-demo-webhook-secret', checkoutBaseUrl: 'http://localhost:3000/' });
  const forger = new MockPaymentGateway({ rpc, webhookSecret: 'not-the-secret' });
  const complete = async (reference: string, outcome: string) => {
    const { error } = await rpc('mock_provider_complete', { p_reference: reference, p_outcome: outcome });
    if (error) throw new Error(error.message);
  };
  const data = async (reference: string) => (await rpc('mock_provider_get', { p_reference: reference })).data;
  return {
    label: 'Demo gateway (MockPaymentGateway)',
    gateway,
    async pay(reference, amountMinor) {
      await complete(reference, 'success');
      if (amountMinor !== undefined) await db.query(`update mock_provider.transactions set amount_minor = $2 where reference = $1`, [reference, amountMinor]);
    },
    decline: (reference) => complete(reference, 'decline'),
    setPending: (reference) => complete(reference, 'pending'),
    async successEvent(reference) {
      return gateway.signedEvent('charge.success', await data(reference));
    },
    event: (name, payload) => gateway.signedEvent(name, payload),
    async forgedEvent(reference) {
      return forger.signedEvent('charge.success', await data(reference));
    },
    close: async () => undefined,
  };
}
