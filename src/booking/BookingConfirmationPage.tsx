import { CalendarCheck, CircleAlert, Clock, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { startPayment, verifyPayment, type PaymentOutcome } from '../services/paymentService';
import DemoPaymentNotice from './components/DemoPaymentNotice';
import { focusRing, PrimaryButton, SecondaryButton } from './components/ui';
import { DEFAULT_TIMEZONE, formatDateLong, formatTime, localDateOf } from './dates';
import { messageFor } from './messages';
import { forgetPendingPayment, recallPendingPayment, rememberPendingPayment } from './pendingPayment';

// Where the payment provider sends the guest back (?view=payment-return&reference=...).
// Everything shown here comes from the server's verification of the payment,
// never from the address or the browser.

const REFUND_REASONS: Record<string, string> = {
  slot_retaken: 'Your reserved time ran out and was booked by another guest before your payment reached us.',
  hold_released: 'The reserved time had already been released when your payment reached us.',
  slot_passed: 'The appointment time had already passed when your payment reached us.',
  schedule_changed: 'Our schedule changed for that time before your payment reached us.',
  service_changed: 'The treatment changed before your payment reached us.',
  therapist_unavailable: 'The therapist is no longer available for this treatment.',
  amount_mismatch: 'The amount received did not match your booking.',
  currency_mismatch: 'Your payment was made in a different currency.',
  duplicate_payment: 'This booking had already been paid for, so this payment was not needed.',
};

const WHATSAPP = `https://wa.me/2348118599365?text=${encodeURIComponent('Hi! I have a question about my booking.')}`;
const POLL_EVERY_MS = 3000;
const MAX_AUTO_CHECKS = 10;

export interface ConfirmationApi {
  verifyPayment: typeof verifyPayment;
  startPayment: typeof startPayment;
}

function Card({ icon, title, tone, children }: { icon: ReactNode; title: string; tone: 'good' | 'wait' | 'bad'; children: ReactNode }) {
  const toneClass = tone === 'good' ? 'text-green-800' : tone === 'bad' ? 'text-spa-berry' : 'text-spa-charcoal';
  return (
    <section className="space-y-4 rounded border border-spa-taupe bg-white p-6 shadow-2xl sm:p-10">
      <div className={`flex items-center gap-3 ${toneClass}`}>
        {icon}
        {/* Focused programmatically so the result is announced; not a control, so no focus ring. */}
        <h1 tabIndex={-1} className="font-serif text-2xl focus:outline-none sm:text-3xl" data-autofocus>
          {title}
        </h1>
      </div>
      <div className="space-y-4 text-sm text-spa-charcoal">{children}</div>
    </section>
  );
}

export default function BookingConfirmationPage({
  reference,
  api = { verifyPayment, startPayment },
  navigate = (url: string) => window.location.assign(url),
  timeZone = DEFAULT_TIMEZONE,
  pollEveryMs = POLL_EVERY_MS,
}: {
  reference: string;
  api?: ConfirmationApi;
  navigate?: (url: string) => void;
  timeZone?: string;
  /** How often a pending payment is re-checked. */
  pollEveryMs?: number;
}) {
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // Counts completed checks: polling must not depend on each answer being a new object.
  const [completedChecks, setCompletedChecks] = useState(0);
  const checks = useRef(0);
  const pending = recallPendingPayment(reference);
  const mainRef = useRef<HTMLElement>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const result = await api.verifyPayment(reference);
      setOutcome(result);
      if (result.status === 'confirmed' || result.status === 'refund_required') forgetPendingPayment(reference);
    } catch (err) {
      setError((err as { code?: string })?.code ?? 'unknown');
    } finally {
      setChecking(false);
      setCompletedChecks((n) => n + 1);
    }
  }, [api, reference]);

  useEffect(() => {
    void check();
  }, [check]);

  // The provider's confirmation can lag the redirect: keep asking for a while.
  useEffect(() => {
    if (outcome?.status !== 'pending' || checks.current >= MAX_AUTO_CHECKS) return;
    const timer = setTimeout(() => {
      checks.current += 1;
      void check();
    }, pollEveryMs);
    return () => clearTimeout(timer);
  }, [outcome?.status, completedChecks, check, pollEveryMs]);

  // Announce the result by moving focus to its heading.
  useEffect(() => {
    mainRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [outcome?.status, error]);

  async function retry() {
    if (!pending) return;
    setRetrying(true);
    setError(null);
    try {
      const start = await api.startPayment(pending.holdToken, { callbackUrl: `${window.location.origin}/?view=payment-return` });
      rememberPendingPayment(start.reference, { holdToken: pending.holdToken, demo: start.demo });
      navigate(start.checkoutUrl);
    } catch (err) {
      setError((err as { code?: string })?.code ?? 'unknown');
      setRetrying(false);
    }
  }

  const appointment = outcome?.appointment;
  const demo = outcome?.demo ?? pending?.demo ?? false;

  return (
    <div className="min-h-screen bg-spa-cream text-spa-charcoal">
      <header className="bg-spa-charcoal">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <a href="/" className={`rounded ${focusRing}`}>
            <img src="/assets/images/smm_logo_cropped.png" alt="SMM (Sweet Mobile Massage and Spa) — back to the website" className="h-14 w-auto" />
          </a>
          <a href="/" className={`min-h-11 content-center rounded px-2 text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold ${focusRing}`}>
            Back to website
          </a>
        </div>
      </header>

      <main ref={mainRef} className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6 sm:py-16">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-spa-gold-dark">Your booking</p>

        {demo && <DemoPaymentNotice />}

        {!outcome && !error && (
          <p role="status" className="text-center text-sm text-spa-clay">
            Checking your payment with the payment provider…
          </p>
        )}

        {error && (
          <Card icon={<CircleAlert className="h-7 w-7" aria-hidden="true" />} title="We could not check your payment" tone="bad">
            <p role="alert">{messageFor(error)}</p>
            {error !== 'payment_not_found' && <PrimaryButton onClick={() => void check()} busy={checking}>Check again</PrimaryButton>}
          </Card>
        )}

        {outcome?.status === 'confirmed' && appointment && (
          <Card icon={<CalendarCheck className="h-7 w-7" aria-hidden="true" />} title="Your booking is confirmed" tone="good">
            <p>Thank you. We look forward to welcoming you.</p>
            <dl className="grid grid-cols-1 gap-4 rounded border border-spa-taupe bg-spa-linen p-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-widest text-spa-clay">Date</dt>
                <dd className="font-serif text-lg">{formatDateLong(localDateOf(appointment.startsAt, timeZone))}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-widest text-spa-clay">Time (Lagos)</dt>
                <dd className="font-serif text-lg">
                  {formatTime(appointment.startsAt, timeZone)} – {formatTime(appointment.endsAt, timeZone)}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-widest text-spa-clay">Booking reference</dt>
                <dd className="break-all font-mono text-base">{appointment.reference}</dd>
              </div>
            </dl>
            <p className="text-spa-clay">Please keep your booking reference. To change or cancel, message us on WhatsApp or call us at least 24 hours before your appointment.</p>
          </Card>
        )}

        {outcome?.status === 'pending' && (
          <Card icon={<Clock className="h-7 w-7" aria-hidden="true" />} title="Waiting for payment confirmation" tone="wait">
            <p>The payment provider has not confirmed your payment yet. Your booking is confirmed only once it does. This page checks again automatically.</p>
            <SecondaryButton onClick={() => void check()} disabled={checking}>
              {checking ? 'Checking…' : 'Check again now'}
            </SecondaryButton>
          </Card>
        )}

        {outcome?.status === 'failed' && (
          <Card icon={<CircleAlert className="h-7 w-7" aria-hidden="true" />} title="Your payment did not go through" tone="bad">
            <p>No booking was made and you have not been charged.</p>
            {pending ? (
              <PrimaryButton onClick={() => void retry()} busy={retrying}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Try paying again
              </PrimaryButton>
            ) : (
              <a href="/#booking" className={`inline-flex min-h-11 items-center rounded bg-spa-charcoal px-6 py-3 text-xs font-bold uppercase tracking-widest text-spa-cream hover:bg-spa-gold hover:text-spa-charcoal ${focusRing}`}>
                Start a new booking
              </a>
            )}
            {pending && <p className="text-xs text-spa-clay">If your reserved time has run out, you will be asked to choose a time again.</p>}
          </Card>
        )}

        {outcome?.status === 'refund_required' && (
          <Card icon={<CircleAlert className="h-7 w-7" aria-hidden="true" />} title="We received your payment, but could not complete the booking" tone="bad">
            <p>{REFUND_REASONS[outcome.reason ?? ''] ?? 'Your booking could not be completed.'}</p>
            <p>
              <strong>You will be refunded in full.</strong> We have been notified and will be in touch. You can also reach us on{' '}
              <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className={`underline ${focusRing}`}>
                WhatsApp
              </a>
              .
            </p>
          </Card>
        )}

        <p className="text-center text-xs text-spa-clay">
          Payment reference: <span className="break-all font-mono">{reference}</span>
        </p>
      </main>
    </div>
  );
}
