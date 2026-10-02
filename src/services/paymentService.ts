import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireSupabase } from '../lib/supabase';

// Guest payment calls, through the `payments` Edge Function.
//
// The browser never decides that a payment succeeded. After the hosted checkout
// sends the guest back, call verifyPayment(reference): the server asks the
// payment provider and returns the outcome. Only `confirmed` means a booking exists.

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
}

export type PaymentErrorCode =
  | 'hold_expired'
  | 'customer_required'
  | 'address_required'
  | 'nothing_to_pay'
  | 'payments_disabled'
  | 'payment_not_found'
  | 'gateway_unavailable'
  | 'invalid_request'
  | 'rate_limited'
  | 'server_error';

export class PaymentError extends Error {
  constructor(public readonly code: PaymentErrorCode) {
    super(code);
    this.name = 'PaymentError';
  }
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke('payments', { body });
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
  return invoke<PaymentStart>({ action: 'initialize', holdToken, ...options });
}

/** Asks the server for the verified outcome of a payment. */
export function verifyPayment(reference: string): Promise<PaymentOutcome> {
  return invoke<PaymentOutcome>({ action: 'verify', reference });
}
