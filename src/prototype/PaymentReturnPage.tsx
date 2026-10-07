import { useCallback, useEffect, useRef, useState } from 'react';
import { startPayment, verifyPayment, type PaymentOutcome } from '../services/paymentService';
import DemoPaymentNotice from '../booking/components/DemoPaymentNotice';
import { forgetPendingPayment, recallPendingPayment, rememberPendingPayment } from '../booking/pendingPayment';
import PrototypeShell, { Button, ErrorMessage, formatSlot, messageFor, Panel } from './PrototypeShell';

// Where the checkout sends the guest back (?reference=...). The outcome shown
// here always comes from the server's verification, never from the URL.

const REFUND_REASONS: Record<string, string> = {
  slot_retaken: 'Your reserved time ran out and was booked by someone else before the payment arrived.',
  hold_released: 'The reserved time had been released before the payment arrived.',
  slot_passed: 'The appointment time had already passed when the payment arrived.',
  schedule_changed: 'The schedule changed (for example the therapist became unavailable) before the payment arrived.',
  service_changed: 'The treatment was changed or withdrawn before the payment arrived.',
  therapist_unavailable: 'The therapist is no longer available for this treatment.',
  amount_mismatch: 'The amount received did not match the booking.',
  currency_mismatch: 'The payment was made in a different currency.',
  duplicate_payment: 'This booking had already been paid for.',
};

const MAX_AUTO_CHECKS = 10;

export default function PaymentReturnPage({ reference }: { reference: string }) {
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const checks = useRef(0);
  const pending = recallPendingPayment(reference);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const result = await verifyPayment(reference);
      setOutcome(result);
      if (result.status === 'confirmed' || result.status === 'refund_required') forgetPendingPayment(reference);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setChecking(false);
    }
  }, [reference]);

  useEffect(() => {
    void check();
  }, [check]);

  // Keep asking for a short while: the provider's confirmation can lag the redirect.
  useEffect(() => {
    if (outcome?.status !== 'pending' || checks.current >= MAX_AUTO_CHECKS) return;
    const timer = setTimeout(() => {
      checks.current += 1;
      void check();
    }, 3000);
    return () => clearTimeout(timer);
  }, [outcome, check]);

  async function retry() {
    if (!pending) return;
    setError(null);
    try {
      const start = await startPayment(pending.holdToken, { callbackUrl: `${window.location.origin}/?view=payment-return` });
      rememberPendingPayment(start.reference, { holdToken: pending.holdToken, demo: start.demo });
      window.location.assign(start.checkoutUrl);
    } catch (err) {
      setError(messageFor(err));
    }
  }

  return (
    <PrototypeShell title="Your booking">
      {(outcome?.demo ?? pending?.demo) && <DemoPaymentNotice />}
      <ErrorMessage message={error} />

      {!outcome && !error && <p className="text-sm">Checking your payment with the payment provider…</p>}

      {outcome?.status === 'confirmed' && outcome.appointment && (
        <Panel>
          <h2 className="text-xl font-semibold text-green-800">Booking confirmed</h2>
          <p className="mt-2 text-sm">{formatSlot(outcome.appointment.startsAt)} (Lagos time)</p>
          <p className="mt-1 text-sm">
            Booking reference: <span className="font-mono">{outcome.appointment.reference}</span>
          </p>
        </Panel>
      )}

      {outcome?.status === 'pending' && (
        <Panel>
          <h2 className="text-xl font-semibold">Waiting for payment confirmation</h2>
          <p className="mt-2 text-sm">
            The payment provider has not confirmed your payment yet. Your booking is not confirmed until it does.
          </p>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => void check()} disabled={checking}>
              Check again
            </Button>
          </div>
        </Panel>
      )}

      {outcome?.status === 'failed' && (
        <Panel>
          <h2 className="text-xl font-semibold text-spa-berry">Payment did not go through</h2>
          <p className="mt-2 text-sm">No booking was made and you have not been charged.</p>
          {pending && (
            <div className="mt-4">
              <Button onClick={() => void retry()}>Try paying again</Button>
            </div>
          )}
        </Panel>
      )}

      {outcome?.status === 'refund_required' && (
        <Panel>
          <h2 className="text-xl font-semibold text-spa-berry">Payment received, but the booking could not be made</h2>
          <p className="mt-2 text-sm">{REFUND_REASONS[outcome.reason ?? ''] ?? 'The booking could not be completed.'}</p>
          <p className="mt-2 text-sm">The business has been notified and will refund you in full.</p>
        </Panel>
      )}

      <p className="text-xs text-spa-charcoal/60">
        Payment reference: <span className="font-mono">{reference}</span>
      </p>
    </PrototypeShell>
  );
}
