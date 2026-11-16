// Lets the floating WhatsApp concierge get out of the way of booking: its
// panel closes when this event fires.
export const BOOKING_ENGAGED_EVENT = 'smm:booking-engaged';

/** Fired when the guest heads to, or starts using, the booking funnel. */
export function announceBookingEngaged(): void {
  window.dispatchEvent(new CustomEvent(BOOKING_ENGAGED_EVENT));
}
