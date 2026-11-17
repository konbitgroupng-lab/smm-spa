// What the guest is told for each error code the funnel or the server can produce.

const MESSAGES: Record<string, string> = {
  slot_unavailable: 'Sorry, that time has just been booked by someone else. Please choose another time.',
  hold_expired: 'Your reserved time ran out before the booking was completed, so it has been released. Please choose a time again.',
  invalid_details: 'Please check the highlighted details.',
  invalid_customer: 'Please check your name, email address and phone number.',
  customer_required: 'Please enter your details before paying.',
  address_required: 'Please enter the address for your in-home appointment.',
  dispatch_zone_required: 'Please choose your area for an in-home appointment.',
  service_unavailable: 'This treatment is not available for online booking at the moment.',
  therapist_unavailable: 'This therapist is not available for this treatment. Please choose another therapist.',
  payments_disabled: 'Online payment is not available at the moment. Please contact us to book.',
  demo_payments_disabled: 'Online payment is not available at the moment. Please contact us to book.',
  gateway_unavailable: 'We could not reach the payment provider. Your time is still reserved. Please try again.',
  rate_limited: 'Too many attempts in a short time. Please wait a few minutes and try again.',
  payment_not_found: 'We could not find this payment.',
  // Bank transfer
  transfers_disabled: 'Paying by bank transfer is not available at the moment. Please pay online or contact us.',
  transfer_too_late: 'This appointment starts too soon to pay by bank transfer. Please pay online, choose a later time, or message us on WhatsApp.',
  transfer_limit: 'You already have bookings waiting for a bank transfer. Please complete those transfers first, or message us on WhatsApp.',
  already_paid: 'This booking has already been paid online.',
  schedule_changed: 'This time is no longer available because our schedule changed. Please choose another time.',
  transfer_not_found: 'We could not find this booking. Please check the link, or message us on WhatsApp.',
};

export function messageFor(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || 'Something went wrong on our side. Please try again.';
}
