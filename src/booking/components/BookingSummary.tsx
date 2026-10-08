import { formatMoney } from '../../lib/money';
import { formatDateLong, formatTime, localDateOf } from '../dates';
import type { BookingFunnel } from '../useBookingFunnel';
import HoldTimer from './HoldTimer';

// The guest's choices so far and what they will pay. Before payment starts the
// price is an estimate from the catalogue; once the server has started the
// payment, its amount replaces the estimate and is labelled as final.

export function PriceBlock({ funnel, currency }: { funnel: BookingFunnel; currency: string }) {
  const { estimate, state } = funnel;
  const payment = state.payment;
  if (payment) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-widest text-spa-charcoal">{payment.kind === 'deposit' ? 'Deposit due now' : 'Amount due now'}</p>
        <p className="font-serif text-2xl text-spa-charcoal" data-testid="final-amount">
          {formatMoney(payment.amountMinor, payment.currency)}
        </p>
        {payment.kind === 'deposit' && <p className="text-xs text-spa-clay-text">of {formatMoney(payment.bookingTotalMinor, payment.currency)} in total</p>}
        <p className="text-xs text-spa-clay-text">Confirmed by our booking system.</p>
      </div>
    );
  }
  if (!estimate) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-bold uppercase tracking-widest text-spa-charcoal">Estimated total</p>
      <p className="font-serif text-2xl text-spa-charcoal" data-testid="estimated-amount">
        {formatMoney(estimate.totalMinor, currency)}
      </p>
      {estimate.travelMinor > 0 && <p className="text-xs text-spa-clay-text">Includes {formatMoney(estimate.travelMinor, currency)} travel fee</p>}
      {estimate.kind === 'deposit' && <p className="text-xs text-spa-clay-text">About {formatMoney(estimate.dueNowMinor, currency)} deposit payable online</p>}
      <p className="text-xs text-spa-clay-text">Estimate. The exact amount is confirmed before you pay.</p>
    </div>
  );
}

export default function BookingSummary({ funnel, currency }: { funnel: BookingFunnel; currency: string }) {
  const { item, zone, therapist, state, timeZone, expiresAt } = funnel;
  const hold = state.hold;
  const rows: [string, string][] = [];
  if (item) rows.push(['Treatment', `${item.name} · ${item.duration} min`]);
  if (item) rows.push(['Where', state.location === 'mobile' ? `In-home${zone ? `, ${zone.name}` : ''}` : 'Boutique Sanctuary']);
  if (item) rows.push(['Therapist', therapist?.name ?? 'Any available therapist']);
  if (hold) rows.push(['When', `${formatDateLong(localDateOf(hold.startsAt, timeZone))}, ${formatTime(hold.startsAt, timeZone)}`]);
  else if (state.date) rows.push(['Date', formatDateLong(state.date)]);

  return (
    <aside aria-label="Your booking" className="space-y-5 rounded border border-spa-taupe bg-spa-linen p-5">
      <h3 className="font-serif text-lg text-spa-charcoal">Your booking</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-spa-clay-text">Choose a treatment to begin.</p>
      ) : (
        <dl className="space-y-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-widest text-spa-clay-text">{label}</dt>
              <dd className="text-spa-charcoal">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {expiresAt && hold && <HoldTimer expiresAt={expiresAt} />}
      <PriceBlock funnel={funnel} currency={currency} />
    </aside>
  );
}

/**
 * Compact summary pinned to the bottom of the booking card on small screens.
 * It sticks within the card only (never over the rest of the page), carries no
 * buttons, and hides while the guest is typing so it never covers a field.
 */
export function StickySummaryBar({ funnel, currency, hidden = false }: { funnel: BookingFunnel; currency: string; hidden?: boolean }) {
  const { item, state, estimate, expiresAt, timeZone } = funnel;
  if (!item || hidden) return null;
  const amount = state.payment ? formatMoney(state.payment.amountMinor, state.payment.currency) : estimate ? formatMoney(estimate.totalMinor, currency) : '';
  return (
    // Left padding keeps the content clear of the floating WhatsApp button
    // (bottom-left of the screen), which overlaps this bar when it sticks.
    <div className="sticky bottom-0 z-10 border-t border-spa-taupe bg-white/95 py-3 pl-24 pr-4 backdrop-blur lg:hidden" data-testid="sticky-summary">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-spa-charcoal">{item.name}</p>
          <p className="truncate text-xs text-spa-clay-text">
            {state.hold ? `${formatDateLong(localDateOf(state.hold.startsAt, timeZone))}, ${formatTime(state.hold.startsAt, timeZone)}` : state.date ? formatDateLong(state.date) : `${item.duration} min`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-serif text-base text-spa-charcoal">{amount}</p>
          <p className="text-[11px] uppercase tracking-widest text-spa-clay-text">{state.payment ? 'Due now' : 'Estimate'}</p>
        </div>
      </div>
      {expiresAt && state.hold && (
        <div className="mt-2 border-t border-spa-taupe/60 pt-2">
          <HoldTimer expiresAt={expiresAt} compact />
        </div>
      )}
    </div>
  );
}
