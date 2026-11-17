import { Landmark, Lock } from 'lucide-react';
import { forwardRef } from 'react';
import { formatMoney } from '../../../lib/money';
import type { TransferBooking } from '../../../services/bookingService';
import { formatDateLong, formatTime, localDateOf } from '../../dates';
import type { BookingFunnel } from '../../useBookingFunnel';
import DemoPaymentNotice from '../DemoPaymentNotice';
import { PrimaryButton, SecondaryButton, StepHeading } from '../ui';

/** "2 hours", "90 minutes". */
function holdLength(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`;
  return `${minutes} minutes`;
}

export const PaymentStep = forwardRef<HTMLHeadingElement, {
  funnel: BookingFunnel;
  onCheckout: (url: string) => void;
  /** The guest chose bank transfer and the booking now awaits it. */
  onTransfer: (transfer: TransferBooking) => void;
}>(function PaymentStep({ funnel, onCheckout, onTransfer }, headingRef) {
  const { state, item, zone, therapist, timeZone, estimate } = funnel;
  const payment = state.payment;
  const hold = state.hold!;
  const transfer = funnel.transferEnabled;
  const busy = state.pending === 'transfer';

  // The server's figure once online payment has started; otherwise the same
  // calculation from the catalogue, confirmed by the server on the next page.
  const dueMinor = payment?.amountMinor ?? estimate?.dueNowMinor ?? 0;
  const totalMinor = payment?.bookingTotalMinor ?? estimate?.totalMinor ?? 0;
  const currency = payment?.currency ?? 'NGN';
  const deposit = (payment?.kind ?? estimate?.kind) === 'deposit';

  async function payByTransfer() {
    const booking = await funnel.payByTransfer();
    if (booking) onTransfer(booking);
  }

  return (
    <div className="space-y-8">
      <StepHeading ref={headingRef} hint="Please check your booking before paying.">
        Review &amp; pay
      </StepHeading>

      {/* Shown only when the server says this is a simulated payment. */}
      {payment?.demo && <DemoPaymentNotice />}

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
        <p className="text-xs font-bold uppercase tracking-widest text-spa-charcoal">{deposit ? 'Deposit due now' : 'Amount due now'}</p>
        <p className="mt-1 font-serif text-3xl text-spa-charcoal" data-testid="amount-due">
          {formatMoney(dueMinor, currency)}
        </p>
        {deposit && (
          <p className="mt-1 text-sm text-spa-clay-text">
            Deposit towards {formatMoney(totalMinor, currency)}. The balance is paid at your appointment.
          </p>
        )}
        <p className="mt-2 text-xs text-spa-clay-text">
          {payment ? 'This is the final amount, confirmed by our booking system.' : 'Our booking system confirms the final amount on the next page.'}
        </p>
      </div>

      <div className="space-y-4">
        <p className="text-xs font-bold uppercase tracking-widest text-spa-charcoal">How would you like to pay?</p>
        <div className={`grid grid-cols-1 gap-4 ${payment && transfer ? 'md:grid-cols-2' : ''}`}>
          {payment && (
            <div className="flex flex-col justify-between gap-3 rounded border border-spa-taupe p-4">
              <div>
                <p className="flex items-center gap-2 font-semibold text-spa-charcoal">
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  Pay online now
                </p>
                <p className="mt-1 text-sm text-spa-clay-text">
                  {payment.demo
                    ? 'A demo payment page: no real money is taken.'
                    : 'Card, bank transfer or USSD on our secure payment provider’s page. Your booking is confirmed straight away.'}
                </p>
              </div>
              <PrimaryButton onClick={() => onCheckout(payment.checkoutUrl)} disabled={busy} className="w-full">
                <Lock className="h-4 w-4" aria-hidden="true" />
                {payment.demo ? 'Continue to demo payment' : 'Pay securely'}
              </PrimaryButton>
            </div>
          )}
          {transfer && (
            <div className="flex flex-col justify-between gap-3 rounded border border-spa-taupe p-4">
              <div>
                <p className="flex items-center gap-2 font-semibold text-spa-charcoal">
                  <Landmark className="h-4 w-4" aria-hidden="true" />
                  Pay by bank transfer
                </p>
                <p className="mt-1 text-sm text-spa-clay-text">
                  We reserve your time for {holdLength(funnel.transferHoldMinutes)} and show you our account details. Your booking is
                  confirmed once we see your transfer.
                </p>
              </div>
              {payment ? (
                <SecondaryButton onClick={() => void payByTransfer()} disabled={busy} aria-busy={busy || undefined} className="w-full">
                  <Landmark className="h-4 w-4" aria-hidden="true" />
                  {busy ? 'Reserving…' : 'Pay by bank transfer'}
                </SecondaryButton>
              ) : (
                <PrimaryButton onClick={() => void payByTransfer()} busy={busy} className="w-full">
                  <Landmark className="h-4 w-4" aria-hidden="true" />
                  {busy ? 'Reserving…' : 'Pay by bank transfer'}
                </PrimaryButton>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SecondaryButton onClick={funnel.back} disabled={busy} className="w-full sm:w-auto">Back</SecondaryButton>
      </div>
      {payment && (
        <p className="text-xs text-spa-clay-text">
          Paying online takes you to {payment.demo ? 'a demo payment page' : 'our payment provider'} and brings you back here afterwards.
        </p>
      )}
    </div>
  );
});
