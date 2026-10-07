// Simulated payment provider for development and demos.
//
// It implements the same PaymentGateway interface as PaystackAdapter and speaks
// Paystack's formats (transaction objects, event names, HMAC-SHA512 signatures),
// so everything downstream - the payments endpoint, the webhook receiver and
// public.record_payment_result() - runs exactly as it will with Paystack.
//
// Its "servers" are the mock_provider ledger in the database, reached only with
// the service-role key. Its "hosted checkout" is the site's demo checkout page.
// No real money moves, and the database refuses demo payments unless
// business_settings.allow_demo_payments is true.

import type { Rpc } from '../http.ts';
import { GatewayError, type InitializeInput, type InitializeResult, type PaymentGateway, type VerifiedCharge, type WebhookEvent } from './gateway.ts';
import { chargeFromTransaction, hmacSha512Hex, notFound, parsePaystackEvent, signatureMatches } from './paystack.ts';

export const DEMO_SIGNATURE_HEADER = 'x-demo-signature';

export interface MockGatewayOptions {
  rpc: Rpc;
  /** Signs the simulated provider's webhooks. Server-side only. */
  webhookSecret: string;
  /**
   * Page that plays the provider's hosted checkout. Defaults to the site that
   * the guest returns to (the callback URL's origin).
   */
  checkoutBaseUrl?: string;
}

export class MockPaymentGateway implements PaymentGateway {
  readonly name = 'mock' as const;
  readonly isTestMode = true;
  readonly #rpc: Rpc;
  readonly #secret: string;
  readonly #checkoutBaseUrl: string | undefined;

  constructor(options: MockGatewayOptions) {
    if (!options.webhookSecret) throw new Error('The demo payment gateway needs a webhook secret');
    this.#rpc = options.rpc;
    this.#secret = options.webhookSecret;
    this.#checkoutBaseUrl = options.checkoutBaseUrl;
  }

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    const base = this.#checkoutBaseUrl ?? (input.callbackUrl ? `${new URL(input.callbackUrl).origin}/` : undefined);
    if (!base) throw new GatewayError('no demo checkout page configured');

    const { error } = await this.#rpc('mock_provider_initialize', {
      p_reference: input.reference,
      p_amount_minor: input.amountMinor,
      p_currency: input.currency,
      p_email: input.email,
      p_callback_url: input.callbackUrl ?? null,
    });
    if (error) throw new GatewayError(`demo provider refused to initialize: ${error.message}`);

    const checkout = new URL(base);
    checkout.searchParams.set('view', 'demo-checkout');
    checkout.searchParams.set('reference', input.reference);
    return { checkoutUrl: checkout.toString() };
  }

  async verify(reference: string): Promise<VerifiedCharge> {
    const { data, error } = await this.#rpc('mock_provider_get', { p_reference: reference });
    if (error) throw new GatewayError('demo provider unavailable');
    return data ? chargeFromTransaction(reference, data) : notFound(reference);
  }

  verifyWebhookSignature(rawBody: string, headers: Headers): Promise<boolean> {
    return signatureMatches(this.#secret, rawBody, headers.get(DEMO_SIGNATURE_HEADER));
  }

  parseWebhook(rawBody: string): WebhookEvent {
    return parsePaystackEvent(rawBody);
  }

  /** A webhook delivery as the simulated provider would send it. */
  async signedEvent(event: string, data: Record<string, unknown>): Promise<{ body: string; headers: Record<string, string> }> {
    const body = JSON.stringify({ event, data });
    return { body, headers: { 'content-type': 'application/json', [DEMO_SIGNATURE_HEADER]: await hmacSha512Hex(this.#secret, body) } };
  }
}

/**
 * The demo webhook secret is derived from the service-role key, which every
 * Edge Function already has, so the functions agree on it without another
 * secret to configure. It never leaves the server.
 */
export function deriveDemoWebhookSecret(serviceRoleKey: string): Promise<string> {
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for the demo payment gateway');
  return hmacSha512Hex(serviceRoleKey, 'smm-demo-payment-webhook');
}
