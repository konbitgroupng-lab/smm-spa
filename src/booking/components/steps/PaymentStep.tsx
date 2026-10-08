import { Lock } from 'lucide-react';
import { forwardRef } from 'react';
import { formatMoney } from '../../../lib/money';
import { formatDateLong, formatTime, localDateOf } from '../../dates';
import type { BookingFunnel } from '../../useBookingFunnel';
import DemoPaymentNotice from '../DemoPaymentNotice';
import { PrimaryButton, SecondaryButton, StepHeading } from '../ui';

export const PaymentStep = forwardRef<HTMLHeadingElement, { funnel: BookingFunnel; onCheckout: (url: string) => void }>(function PaymentStep({ funnel, onCheckout }, headingRef) {
  const { state, item, zone, therapist, timeZone } = funnel;
  const payment = state.payment!;
  const hold = state.hold!;

  return (
    <div className="space-y-8">
      <StepHeading ref={headingRef} hint="Please check your booking before paying.">
        Review &amp; pay
      </StepHeading>

      {/* Shown only when the server says this is a simulated payment. */}
      {payment.demo && <DemoPaymentNotice />}

      <dl className="grid grid-cols-1 gap-4 rounded border border-spa-taupe p-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-widest text-spa-clay-text">Treatment</dt>
          <dd>{item?.name} · {item?.duration} min</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-widest text-spa-clay-text">When</dt>
          <dd>
            {formatDateLong(localDateOf(hold.startsAt, timeZone))}, {formatTime(hold.startsAt, timeZone)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-widest text-spa-clay-text">Where</dt>
          <dd>{state.location === 'mobile' ? `${state.serviceAddress.trim()}${zone ? ` (${zone.name})` : ''}` : 'Boutique Sanctuary, Mende, Maryland'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-widest text-spa-clay-text">Therapist</dt>
          <dd>{therapist?.name ?? 'Any available therapist'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-widest text-spa-clay-text">Contact</dt>
          <dd className="break-words">
            {state.details.fullName} · {state.details.email} · {state.details.phone}
          </dd>
        </div>
      </dl>

      <div className="rounded border-2 border-spa-charcoal bg-spa-cream p-5">
        <p className="text-xs font-bold uppercase tracking-widest text-spa-charcoal">{payment.kind === 'deposit' ? 'Deposit due now' : 'Amount due now'}</p>
        <p className="mt-1 font-serif text-3xl text-spa-charcoal" data-testid="amount-due">
          {formatMoney(payment.amountMinor, payment.currency)}
        </p>
        {payment.kind === 'deposit' && (
          <p className="mt-1 text-sm text-spa-clay-text">
            Deposit towards {formatMoney(payment.bookingTotalMinor, payment.currency)}. The balance is paid at your appointment.
          </p>
        )}
        <p className="mt-2 text-xs text-spa-clay-text">This is the final amount, confirmed by our booking system.</p>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SecondaryButton onClick={funnel.back} className="w-full sm:w-auto">Back</SecondaryButton>
        <PrimaryButton onClick={() => onCheckout(payment.checkoutUrl)} className="w-full sm:w-auto">
          <Lock className="h-4 w-4" aria-hidden="true" />
          {payment.demo ? 'Continue to demo payment' : 'Pay securely'}
        </PrimaryButton>
      </div>
      <p className="text-xs text-spa-clay-text">
        You will be taken to {payment.demo ? 'a demo payment page' : 'our payment provider'} and brought back here afterwards. Your booking is confirmed once payment is received.
      </p>
    </div>
  );
});
