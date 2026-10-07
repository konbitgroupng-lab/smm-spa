// Paystack adapter for the PaymentGateway interface.
//
// API used (https://paystack.com/docs/api):
//   POST /transaction/initialize         create a hosted-checkout transaction
//   GET  /transaction/verify/:reference  the authoritative state of a transaction
// Webhooks are signed with HMAC-SHA512 of the raw body, keyed with the secret
// key, sent in the x-paystack-signature header.

import {
  GatewayError,
  type InitializeInput,
  type InitializeResult,
  type PaymentGateway,
  type VerifiedCharge,
  type WebhookEvent,
} from './gateway.ts';

export interface PaystackOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Compares two byte strings in time that does not depend on where they differ. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function hmacSha512Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
  return Array.from(signature, (b) => b.toString(16).padStart(2, '0')).join('');
}

const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const int = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) ? value : null);

export class PaystackAdapter implements PaymentGateway {
  readonly name = 'paystack' as const;
  readonly isTestMode: boolean;
  readonly #secretKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(secretKey: string, options: PaystackOptions = {}) {
    if (!/^sk_(test|live)_/.test(secretKey)) throw new Error('PAYSTACK_SECRET_KEY must be a Paystack secret key (sk_test_... or sk_live_...)');
    this.#secretKey = secretKey;
    this.isTestMode = secretKey.startsWith('sk_test_');
    this.#baseUrl = (options.baseUrl ?? 'https://api.paystack.co').replace(/\/$/, '');
    this.#fetch = options.fetch ?? fetch;
  }

  async #request(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.#secretKey}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new GatewayError('paystack unreachable');
    }
    let json: any = null;
    try {
      json = await response.json();
    } catch {
      // Non-JSON answer: handled by the status checks below.
    }
    if (response.status >= 500 || response.status === 401 || response.status === 403 || response.status === 429) {
      throw new GatewayError(`paystack answered ${response.status}`, response.status);
    }
    return { status: response.status, json };
  }

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    const { status, json } = await this.#request('POST', '/transaction/initialize', {
      reference: input.reference,
      amount: input.amountMinor,
      currency: input.currency,
      email: input.email,
      callback_url: input.callbackUrl,
    });
    const checkoutUrl = str(json?.data?.authorization_url);
    if (status >= 300 || json?.status !== true || !checkoutUrl) {
      throw new GatewayError(`paystack refused to initialize: ${str(json?.message) ?? status}`, status);
    }
    return { checkoutUrl };
  }

  async verify(reference: string): Promise<VerifiedCharge> {
    const { status, json } = await this.#request('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    if (status >= 300 || json?.status !== true || !json?.data) return notFound(reference);
    return chargeFromTransaction(reference, json.data);
  }

  verifyWebhookSignature(rawBody: string, headers: Headers): Promise<boolean> {
    return signatureMatches(this.#secretKey, rawBody, headers.get('x-paystack-signature'));
  }

  parseWebhook(rawBody: string): WebhookEvent {
    return parsePaystackEvent(rawBody);
  }
}

// ---------------------------------------------------------------------------
// Paystack's formats. Also used by the simulated provider (mock.ts), which
// speaks the same formats so that both adapters are interpreted identically.
// ---------------------------------------------------------------------------

/** Unknown at the provider (or not found yet): certainly not paid. */
export function notFound(reference: string): VerifiedCharge {
  return { reference, status: 'pending', amountMinor: null, currency: null, paidAt: null, transactionId: null, channel: null, failureReason: 'not_found' };
}

/** Normalises a transaction object as returned by Paystack's verify API. */
export function chargeFromTransaction(reference: string, data: any): VerifiedCharge {
  // The answer must be for the reference we asked about; anything else is not proof of payment.
  const sameReference = data.reference === reference;
  const provider = String(data.status ?? '');
  const charge: VerifiedCharge = {
    reference,
    status: 'pending',
    amountMinor: int(data.amount),
    currency: str(data.currency),
    paidAt: str(data.paid_at) ?? str(data.paidAt),
    transactionId: data.id === undefined || data.id === null ? null : String(data.id),
    channel: str(data.channel),
    failureReason: null,
  };
  if (provider === 'success' && sameReference && charge.amountMinor !== null && charge.currency !== null) {
    charge.status = 'success';
  } else if (provider === 'failed' || provider === 'reversed') {
    charge.status = 'failed';
    charge.failureReason = str(data.gateway_response) ?? provider;
  }
  // abandoned | ongoing | pending | processing | queued: the guest has not paid (yet).
  return charge;
}

/** HMAC-SHA512 of the raw body, keyed with `secret`, compared in constant time. */
export async function signatureMatches(secret: string, rawBody: string, signatureHex: string | null): Promise<boolean> {
  const given = hexToBytes(signatureHex ?? '');
  if (!given || given.length === 0) return false;
  const expected = hexToBytes(await hmacSha512Hex(secret, rawBody))!;
  return constantTimeEqual(given, expected);
}

/** Parses a webhook body whose signature has already been verified. Throws on malformed input. */
export function parsePaystackEvent(rawBody: string): WebhookEvent {
  const body = JSON.parse(rawBody);
  const eventType = str(body?.event);
  const data = body?.data;
  if (!eventType || typeof data !== 'object' || data === null) throw new Error('malformed webhook');

  // Only non-sensitive fields are kept. In particular the card authorization
  // (a reusable charge token) and customer details are never stored.
  const summary: Record<string, unknown> = {
    event: eventType,
    id: data.id ?? null,
    reference: data.reference ?? data.transaction_reference ?? null,
    status: data.status ?? null,
    amount: data.amount ?? null,
    currency: data.currency ?? null,
    channel: data.channel ?? null,
    domain: data.domain ?? null,
  };

  if (eventType === 'charge.success') {
    const reference = str(data.reference);
    if (!reference) throw new Error('malformed webhook');
    return { kind: 'charge_success', eventType, eventId: `${eventType}:${data.id ?? reference}`, reference, summary };
  }

  if (['refund.pending', 'refund.processing', 'refund.processed', 'refund.failed', 'refund.needs-attention'].includes(eventType)) {
    const transactionReference = str(data.transaction_reference);
    if (!transactionReference) throw new Error('malformed webhook');
    const refundReference = str(data.refund_reference);
    summary.refund_reference = refundReference;
    return {
      kind: 'refund',
      eventType,
      eventId: `${eventType}:${refundReference ?? transactionReference}`,
      refund: {
        transactionReference,
        refundReference,
        // The event name is authoritative; data.status adds "needs-attention".
        status: data.status === 'needs-attention' ? 'needs-attention' : eventType.slice('refund.'.length),
        amountMinor: int(typeof data.amount === 'string' ? Number(data.amount) : data.amount),
        reason: str(data.merchant_note) ?? str(data.customer_note) ?? str(data.message),
      },
      summary,
    };
  }

  return { kind: 'ignored', eventType, eventId: `${eventType}:${data.id ?? data.reference ?? 'unknown'}`, summary };
}
