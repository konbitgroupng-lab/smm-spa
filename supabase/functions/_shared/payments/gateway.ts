// Provider-neutral payment interface. Handlers depend only on this file, so a
// different provider can be added by writing another adapter.
//
// Web-standard APIs only: the same code runs in the Supabase Edge runtime and
// in the Node test suite.

/** `mock` is the simulated provider used until real credentials are connected. */
export type ProviderName = 'paystack' | 'stripe' | 'mock';

export interface InitializeInput {
  reference: string;
  /** Amount in minor units (kobo for NGN). Always computed by the database. */
  amountMinor: number;
  currency: string;
  email: string;
  /** Where the hosted checkout sends the guest afterwards. */
  callbackUrl?: string;
}

export interface InitializeResult {
  checkoutUrl: string;
}

/** The provider's verdict on a transaction, normalised. */
export interface VerifiedCharge {
  reference: string;
  /** `pending` covers every "not paid yet" state, including an unknown reference. */
  status: 'success' | 'failed' | 'pending';
  amountMinor: number | null;
  currency: string | null;
  paidAt: string | null;
  transactionId: string | null;
  channel: string | null;
  failureReason: string | null;
}

export interface RefundUpdate {
  transactionReference: string;
  refundReference: string | null;
  /** Provider wording: pending | processing | processed | failed | needs-attention */
  status: string;
  amountMinor: number | null;
  reason: string | null;
}

export type WebhookEvent =
  | { kind: 'charge_success'; eventId: string; eventType: string; reference: string; summary: Record<string, unknown> }
  | { kind: 'refund'; eventId: string; eventType: string; refund: RefundUpdate; summary: Record<string, unknown> }
  | { kind: 'ignored'; eventId: string; eventType: string; summary: Record<string, unknown> };

export interface PaymentGateway {
  readonly name: ProviderName;
  /** True when the configured credentials are test-mode credentials. */
  readonly isTestMode: boolean;
  initialize(input: InitializeInput): Promise<InitializeResult>;
  /** Asks the provider for the truth about a transaction. Throws GatewayError if it cannot be reached. */
  verify(reference: string): Promise<VerifiedCharge>;
  /** Checks that a webhook body was signed by the provider. */
  verifyWebhookSignature(rawBody: string, headers: Headers): Promise<boolean>;
  /** Parses a webhook body whose signature has already been verified. Throws on malformed input. */
  parseWebhook(rawBody: string): WebhookEvent;
}

/** The provider could not be reached or answered unexpectedly. Never carries secrets. */
export class GatewayError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'GatewayError';
  }
}
