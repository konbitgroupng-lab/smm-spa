import { RefreshCw } from 'lucide-react';
import { forwardRef, useMemo } from 'react';
import { bookableDates, formatDateLong, formatTime } from '../../dates';
import type { BookingCatalog } from '../../useBookingCatalog';
import type { BookingFunnel } from '../../useBookingFunnel';
import { focusRing, LiveAnnouncement, SecondaryButton, StepHeading } from '../ui';

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' });
const MONTH = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short' });

export const DateTimeStep = forwardRef<HTMLHeadingElement, { funnel: BookingFunnel; catalog: BookingCatalog }>(function DateTimeStep({ funnel, catalog }, headingRef) {
  const { state, slots, timeZone } = funnel;
  const dates = useMemo(() => bookableDates(catalog.settings.maxAdvanceDays, timeZone), [catalog.settings.maxAdvanceDays, timeZone]);
  const loading = state.pending === 'slots' && state.slots === null;
  const holding = state.pending === 'hold';

  const announcement = !state.date
    ? ''
    : loading
      ? 'Loading available times.'
      : state.slots
        ? slots.length === 0
          ? `No times available on ${formatDateLong(state.date)}.`
          : `${slots.length} time${slots.length === 1 ? '' : 's'} available on ${formatDateLong(state.date)}.`
        : '';

  return (
    <div className="space-y-8">
      <StepHeading ref={headingRef} hint={`All times are Lagos time. You can book up to ${catalog.settings.maxAdvanceDays} days ahead.`}>
        Date &amp; time
      </StepHeading>

      <fieldset className="min-w-0">
        <legend className="mb-3 text-xs font-bold uppercase tracking-widest text-spa-charcoal">Date</legend>
        {/* Scrolls sideways inside itself; never widens the page. */}
        <div className="relative -mx-1 flex max-w-full snap-x gap-2 overflow-x-auto px-1 pb-3 pt-1">
          {dates.map((date) => {
            const d = new Date(`${date}T12:00:00Z`);
            const checked = state.date === date;
            return (
              <label
                key={date}
                className={`relative flex w-[4.5rem] shrink-0 cursor-pointer snap-start flex-col items-center rounded border py-3 text-center transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-spa-gold-dark has-[:focus-visible]:ring-offset-2 ${
                  checked ? 'border-spa-charcoal bg-spa-charcoal text-white' : 'border-spa-taupe bg-white text-spa-charcoal hover:border-spa-gold-dark'
                }`}
              >
                <input type="radio" name="booking-date" value={date} checked={checked} onChange={() => funnel.selectDate(date)} className="sr-only" aria-label={formatDateLong(date)} />
                <span className={`text-[11px] uppercase tracking-wider ${checked ? 'text-spa-gold' : 'text-spa-clay-text'}`} aria-hidden="true">
                  {WEEKDAY.format(d)}
                </span>
                <span className="font-serif text-xl" aria-hidden="true">{d.getUTCDate()}</span>
                <span className="text-[11px]" aria-hidden="true">{MONTH.format(d)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {state.date && (
        <section aria-labelledby="booking-times-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 id="booking-times-heading" className="text-xs font-bold uppercase tracking-widest text-spa-charcoal">
              Times on {formatDateLong(state.date)}
            </h4>
            <button
              type="button"
              onClick={funnel.refreshSlots}
              className={`-mr-2 inline-flex min-h-11 items-center gap-1 rounded px-2 text-xs text-spa-clay-text hover:text-spa-charcoal ${focusRing}`}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Refresh
            </button>
          </div>

          {loading && <p className="text-sm text-spa-clay-text">Checking availability…</p>}

          {!loading && state.slots && slots.length === 0 && (
            <p className="rounded border border-spa-taupe bg-spa-linen p-4 text-sm text-spa-charcoal">
              No times are free on this day{state.therapistId ? ' with this therapist' : ''}. Please try another date{state.therapistId ? ' or choose any available therapist' : ''}.
            </p>
          )}

          {!loading && slots.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5" aria-label="Available times">
              {slots.map((slot) => (
                <li key={slot.startsAt}>
                  <button
                    type="button"
                    disabled={holding}
                    aria-pressed={slot.mine}
                    aria-label={slot.mine ? `${formatTime(slot.startsAt, timeZone)}, reserved for you` : undefined}
                    onClick={() => void funnel.chooseSlot(slot)}
                    className={`flex min-h-11 w-full flex-col items-center justify-center rounded border px-2 py-2 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${focusRing} ${
                      slot.mine ? 'border-spa-gold-dark bg-spa-gold text-spa-charcoal' : 'border-spa-taupe bg-white text-spa-charcoal hover:border-spa-gold-dark hover:bg-spa-cream'
                    }`}
                  >
                    <span>{formatTime(slot.startsAt, timeZone)}</span>
                    {slot.mine && <span className="text-[11px] font-semibold uppercase tracking-wide">Reserved for you</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {holding && <p className="text-sm text-spa-clay-text">Reserving your time…</p>}
        </section>
      )}

      <LiveAnnouncement message={announcement} />

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <SecondaryButton onClick={funnel.back} className="w-full sm:w-auto">Back</SecondaryButton>
        <p className="self-center text-xs text-spa-clay-text">Choosing a time reserves it for you while you finish booking.</p>
      </div>
    </div>
  );
});
