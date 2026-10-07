// Remembers, for this browser tab only, which hold a payment belongs to, so a
// guest returning from a failed checkout can try again. UI convenience only:
// the server never trusts it, and the hold token expires with the hold.

interface PendingPayment {
  holdToken: string;
  demo: boolean;
}

const key = (reference: string) => `smm_payment_${reference}`;

export function rememberPendingPayment(reference: string, value: PendingPayment): void {
  try {
    sessionStorage.setItem(key(reference), JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode): retry is simply not offered.
  }
}

export function recallPendingPayment(reference: string): PendingPayment | null {
  try {
    const raw = sessionStorage.getItem(key(reference));
    return raw ? (JSON.parse(raw) as PendingPayment) : null;
  } catch {
    return null;
  }
}

export function forgetPendingPayment(reference: string): void {
  try {
    sessionStorage.removeItem(key(reference));
  } catch {
    // Nothing to do.
  }
}
