import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireSupabase } from '../lib/supabase';

// Guest payment calls, through the `payments` Edge Function.
//
// The browser never decides that a payment succeeded. After the hosted checkout
// sends the guest back, call verifyPayment(reference): the server asks the
// payment provider and returns the outcome. Only `confirmed` means a booking exists.
//
// While the server is configured with the simulated provider, `demo` is true
// and the checkout is the site's demo checkout page (see the demo* functions
// below). Nothing else differs: the same server path decides the outcome.

export interface PaymentStart {
  reference: string;
  /** Hosted checkout page to send the guest to. */
  checkoutUrl: string;
  /** Amount being charged now, in minor units (a deposit or the full total). */
  amountMinor: number;
  bookingTotalMinor: number;
  currency: string;
  kind: 'deposit' | 'full';
  holdExpiresAt: string;
  provider: 'paystack' | 'stripe' | 'mock';
  /** True when no real money will be charged. Set by the server, never by the browser. */
  demo: boolean;
}

export interface PaymentOutcome {
  /**
   * confirmed        paid and booked
   * pending          not paid yet (keep waiting or let the guest retry)
   * failed           the payment did not go through
   * refund_required  paid, but the booking could not be made; the business will refund
   */
  status: 'confirmed' | 'pending' | 'failed' | 'refund_required';
  reason?: string;
  appointment: { reference: string; startsAt: string; endsAt: string } | null;
  /** True when the payment was simulated. Set by the server. */
  demo: boolean;
}

export type PaymentErrorCode =
  | 'hold_expired'
  | 'customer_required'
  | 'address_required'
  | 'nothing_to_pay'
  | 'payments_disabled'
  | 'demo_payments_disabled'
  | 'payment_not_found'
  | 'transaction_not_found'
  | 'gateway_unavailable'
  | 'not_available'
  | 'invalid_request'
  | 'rate_limited'
  | 'server_error';

export class PaymentError extends Error {
  constructor(public readonly code: PaymentErrorCode) {
    super(code);
    this.name = 'PaymentError';
  }
}

async function invoke<T>(fn: 'payments' | 'demo-checkout', body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke(fn, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      if (payload?.error) throw new PaymentError(payload.error);
    }
    throw new PaymentError('server_error');
  }
  return data as T;
}

/**
 * Starts payment for a hold that already has customer details. The amount is
 * set by the server. `callbackUrl` must be on this site; the checkout returns
 * the guest there with `?reference=...`.
 */
export function startPayment(
  holdToken: string,
  options: { serviceAddress?: string; notes?: string; callbackUrl?: string } = {},
): Promise<PaymentStart> {
  return invoke<PaymentStart>('payments', { action: 'initialize', holdToken, ...options });
}

/** Asks the server for the verified outcome of a payment. */
export function verifyPayment(reference: string): Promise<PaymentOutcome> {
  return invoke<PaymentOutcome>('payments', { action: 'verify', reference });
}

// ---------------------------------------------------------------------------
// Simulated provider's hosted checkout (development and demos only)
// ---------------------------------------------------------------------------

export interface DemoCheckout {
  demo: true;
  reference: string;
  amountMinor: number;
  currency: string;
  /** The simulated provider's view: abandoned (unpaid) | pending | success | failed */
  status: string;
  email: string;
  canReturn: boolean;
}

/** What the guest chooses on the demo checkout page. */
export type DemoOutcome = 'success' | 'decline' | 'pending';

export function getDemoCheckout(reference: string): Promise<DemoCheckout> {
  return invoke<DemoCheckout>('demo-checkout', { action: 'get', reference });
}

/**
 * Plays the guest's action at the simulated provider. This records what the
 * "provider" saw; whether a booking results is still decided by the server.
 * `deliveries` > 1 makes the provider send its webhook more than once.
 */
export function completeDemoCheckout(reference: string, outcome: DemoOutcome, deliveries = 1): Promise<{ status: string; returnUrl: string | null }> {
  return invoke('demo-checkout', { action: 'complete', reference, outcome, deliveries });
}

export function cancelDemoCheckout(reference: string): Promise<{ status: string; returnUrl: string | null }> {
  return invoke('demo-checkout', { action: 'cancel', reference });
}
