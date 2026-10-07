// Moving the guest around the site for booking.

import { announceBookingEngaged } from '../components/widgetEvents';

/** Leaving the site (to a checkout page). An object so tests can replace it. */
export const browser = {
  assign(url: string): void {
    window.location.assign(url);
  },
};

export const BOOKING_SECTION_ID = 'booking';
export const BOOKING_HEADING_ID = 'booking-heading';

/**
 * Scrolls to the booking section and moves keyboard focus to its heading, so
 * keyboard and screen-reader users land where sighted users are taken.
 */
export function goToBooking(): void {
  const section = document.getElementById(BOOKING_SECTION_ID);
  if (!section) return;
  announceBookingEngaged(); // the WhatsApp chat panel closes so it cannot cover the booking steps
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  document.getElementById(BOOKING_HEADING_ID)?.focus({ preventScroll: true });
}
