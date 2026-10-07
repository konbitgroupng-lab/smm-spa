// Lets the floating WhatsApp widget get out of the way of booking. The WhatsApp
// panel closes when this event fires. It was first used by the Calendly popup;
// the event name is kept so the WhatsApp widget itself needs no change.
export const CALENDLY_OPENING_EVENT = 'smm:calendly-opening';

/** Fired when the guest heads to, or starts using, the booking funnel. */
export const BOOKING_ENGAGED_EVENT = CALENDLY_OPENING_EVENT;

export function announceBookingEngaged(): void {
  window.dispatchEvent(new CustomEvent(BOOKING_ENGAGED_EVENT));
}
