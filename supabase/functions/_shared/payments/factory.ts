// Chooses the payment provider from configuration. This is the only place
// that knows which provider is in use.
//
//   PAYMENT_PROVIDER=mock       simulated payments (development and demos)
//   PAYMENT_PROVIDER=paystack   real Paystack; needs PAYSTACK_SECRET_KEY
//
// There is deliberately no default: a missing setting stops the function
// rather than silently taking simulated payments.

import type { Rpc } from '../http.ts';
import type { PaymentGateway } from './gateway.ts';
import { deriveDemoWebhookSecret, MockPaymentGateway } from './mock.ts';
import { PaystackAdapter } from './paystack.ts';

export async function createPaymentGateway(env: (name: string) => string | undefined, rpc: Rpc): Promise<PaymentGateway> {
  const provider = env('PAYMENT_PROVIDER');
  switch (provider) {
    case 'paystack':
      return new PaystackAdapter(env('PAYSTACK_SECRET_KEY') ?? '');
    case 'mock':
      return new MockPaymentGateway({
        rpc,
        webhookSecret: await deriveDemoWebhookSecret(env('SUPABASE_SERVICE_ROLE_KEY') ?? ''),
        checkoutBaseUrl: env('DEMO_CHECKOUT_URL') || undefined,
      });
    default:
      throw new Error("PAYMENT_PROVIDER must be set to 'mock' or 'paystack'");
  }
}
