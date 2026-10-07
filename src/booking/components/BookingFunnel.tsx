import { Check } from 'lucide-react';
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { STEPS, type FunnelStep } from '../funnel';
import type { BookingCatalog } from '../useBookingCatalog';
import { announceBookingEngaged } from '../../components/widgetEvents';
import { browser } from '../navigation';
import { useBookingFunnel, type FunnelApi } from '../useBookingFunnel';
import BookingSummary, { StickySummaryBar } from './BookingSummary';
import { DateTimeStep } from './steps/DateTimeStep';
import { DetailsStep } from './steps/DetailsStep';
import { PaymentStep } from './steps/PaymentStep';
import { ServiceStep } from './steps/ServiceStep';
import { TherapistStep } from './steps/TherapistStep';
import { ErrorBanner, focusRing } from './ui';

const LABELS: Record<FunnelStep, string> = {
  service: 'Treatment',
  therapist: 'Therapist',
  datetime: 'Date & time',
  details: 'Details',
  payment: 'Payment',
};

function StepIndicator({ current, canEnter, onSelect }: { current: FunnelStep; canEnter: (step: FunnelStep) => boolean; onSelect: (step: FunnelStep) => void }) {
  const currentIndex = STEPS.indexOf(current);
  return (
    <nav aria-label="Booking steps" className="border-b border-spa-taupe bg-spa-linen">
      <ol className="grid grid-cols-5">
        {STEPS.map((step, index) => {
          const done = index < currentIndex;
          const active = step === current;
          const reachable = !active && canEnter(step) && index < currentIndex; // only back, never ahead
          return (
            <li key={step} className="border-r border-spa-taupe last:border-r-0">
              <button
                type="button"
                onClick={() => onSelect(step)}
                disabled={!reachable}
                aria-current={active ? 'step' : undefined}
                className={`flex min-h-11 w-full flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] uppercase tracking-wider sm:text-xs ${focusRing} ${
                  active ? 'border-b-2 border-b-spa-gold-dark bg-white font-bold text-spa-charcoal' : done ? 'text-spa-charcoal hover:bg-white/60' : 'text-spa-clay'
                }`}
              >
                <span className="flex items-center gap-1">
                  {done ? <Check className="h-3.5 w-3.5 text-spa-gold-dark" aria-hidden="true" /> : <span aria-hidden="true">{index + 1}</span>}
                  <span className="sr-only">Step {index + 1}: </span>
                </span>
                <span className="hidden sm:inline">{LABELS[step]}</span>
                <span className="sr-only sm:hidden">{LABELS[step]}</span>
                {done && <span className="sr-only">(completed)</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface BookingFunnelProps {
  catalog: BookingCatalog;
  /** Same-site address the checkout returns to. */
  callbackUrl: string;
  preselectServiceId?: string | null;
  api?: FunnelApi;
  /** Leaves for the payment page. Replaced in tests. */
  navigate?: (url: string) => void;
}

export default function BookingFunnel({ catalog, callbackUrl, preselectServiceId, api, navigate = browser.assign }: BookingFunnelProps) {
  const funnel = useBookingFunnel({ catalog, callbackUrl, api, preselectServiceId });
  const { state } = funnel;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [typing, setTyping] = useState(false);

  // A "Book" button elsewhere on the page chose a treatment: switch to it. Any
  // time already reserved for another treatment is given back by the state machine.
  const lastPreselect = useRef(preselectServiceId);
  useEffect(() => {
    if (!preselectServiceId || preselectServiceId === lastPreselect.current) return;
    lastPreselect.current = preselectServiceId;
    funnel.selectService(preselectServiceId);
    funnel.goTo('service');
  }, [preselectServiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Move focus to the new step's heading when the step changes - never on first
  // display, so the page is not scrolled or announced before the guest interacts.
  // Compares with the last step rather than counting renders, so React's strict
  // mode (which runs effects twice) cannot trigger it.
  const lastFocusedStep = useRef(state.step);
  useEffect(() => {
    if (state.step === lastFocusedStep.current) return;
    lastFocusedStep.current = state.step;
    const heading = headingRef.current;
    if (!heading) return;
    // Focus without the browser's own scroll, then bring the heading into view
    // if it is not comfortably visible. The jump is instant: an animated scroll
    // can end in the wrong place when the step's height changes during it. The
    // heading's scroll-margin keeps it below the fixed site header.
    heading.focus({ preventScroll: true });
    const top = heading.getBoundingClientRect().top;
    if (top < 120 || top > window.innerHeight * 0.6) heading.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  }, [state.step]);

  // Hide the sticky summary while a text field has focus, so it can never sit
  // over the field or the on-screen keyboard.
  const isTextField = (el: EventTarget | null) =>
    el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && !['radio', 'checkbox', 'button', 'submit'].includes(el.type));
  // While the guest uses the funnel, the WhatsApp chat panel (which opens by
  // itself once per visit, possibly after booking has begun) is closed so it
  // cannot cover the booking steps. Harmless when it is already closed.
  const engage = () => announceBookingEngaged();
  const onFocus = (e: FocusEvent) => {
    engage();
    setTyping(isTextField(e.target));
  };
  const onBlur = (e: FocusEvent) => {
    if (!isTextField(e.relatedTarget)) setTyping(false);
  };

  const currency = catalog.settings.currency;
  const index = STEPS.indexOf(state.step);

  return (
    // overflow-clip (not overflow-hidden) rounds the corners without making the
    // card a scroll container, which would stop the summary bar from sticking.
    <div className="overflow-clip rounded border border-spa-taupe bg-white shadow-2xl" onFocus={onFocus} onBlur={onBlur} onPointerDown={engage}>
      <div className="flex flex-wrap items-center justify-between gap-2 bg-spa-charcoal px-5 py-4 text-white">
        <h2 className="font-serif text-lg text-spa-gold">Book your treatment</h2>
        <p className="text-xs text-white/70">
          Step {index + 1} of {STEPS.length}
        </p>
      </div>

      <StepIndicator current={state.step} canEnter={funnel.canEnter} onSelect={funnel.goTo} />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-6 p-5 sm:p-8">
          <ErrorBanner code={state.error === 'invalid_details' ? null : state.error} onDismiss={funnel.dismissError} />

          {state.step === 'service' && <ServiceStep ref={headingRef} funnel={funnel} catalog={catalog} />}
          {state.step === 'therapist' && <TherapistStep ref={headingRef} funnel={funnel} />}
          {state.step === 'datetime' && <DateTimeStep ref={headingRef} funnel={funnel} catalog={catalog} />}
          {state.step === 'details' && <DetailsStep ref={headingRef} funnel={funnel} />}
          {state.step === 'payment' && state.payment && <PaymentStep ref={headingRef} funnel={funnel} onCheckout={navigate} />}

          {state.step !== 'service' && (
            <div className="border-t border-spa-taupe pt-4 text-right">
              <button type="button" onClick={funnel.cancel} className={`min-h-11 rounded px-2 text-xs text-spa-clay underline hover:text-spa-berry ${focusRing}`}>
                Start again
              </button>
            </div>
          )}
        </div>

        <div className="hidden border-l border-spa-taupe p-5 lg:block">
          <div className="sticky top-28">
            <BookingSummary funnel={funnel} currency={currency} />
          </div>
        </div>
      </div>

      <StickySummaryBar funnel={funnel} currency={currency} hidden={typing} />
    </div>
  );
}
