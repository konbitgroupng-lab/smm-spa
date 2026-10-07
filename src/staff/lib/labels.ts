import type { AppointmentStatus, BookingSource, PaymentState, Settlement } from './ops';

// Plain words for the codes the server uses.

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending_payment: 'Awaiting payment',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

export const SOURCE_LABEL: Record<BookingSource, string> = {
  online: 'Online',
  phone: 'Phone',
  whatsapp: 'WhatsApp',
};

export const SETTLEMENT_LABEL: Record<Settlement, string> = {
  online_payment: 'Online payment',
  pay_at_venue: 'Pay at venue',
  paid_offline: 'Paid offline',
};

export const PAYMENT_LABEL: Record<PaymentState, string> = {
  paid: 'Paid online',
  deposit_paid: 'Deposit paid online',
  refund_due: 'Refund due',
  refunded: 'Refunded',
  unpaid: 'Not paid',
  to_collect: 'To collect',
  paid_offline: 'Paid offline',
};

/** Badge colours by status: text and background pairs with enough contrast. */
export const STATUS_TONE: Record<AppointmentStatus, string> = {
  pending_payment: 'bg-amber-100 text-amber-900',
  confirmed: 'bg-emerald-100 text-emerald-900',
  completed: 'bg-slate-200 text-slate-900',
  cancelled: 'bg-red-100 text-red-900',
  no_show: 'bg-orange-100 text-orange-900',
};

export const ACTION_LABEL: Record<string, string> = {
  insert: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  'appointment.created_by_staff': 'Booked by staff',
  'appointment.rescheduled': 'Rescheduled',
  'appointment.cancelled': 'Cancelled',
  'appointment.completed': 'Marked completed',
  'appointment.no_show': 'Marked no-show',
  'appointment.status_corrected': 'Status corrected',
  'appointment.details_updated': 'Booking details updated',
  'appointment.settlement_changed': 'Settlement changed',
  'customer.created': 'Customer created',
  'customer.updated': 'Customer record updated',
};

export const FIELD_LABEL: Record<string, string> = {
  starts_at: 'Start',
  ends_at: 'End',
  blocked_until: 'Blocked until',
  therapist_id: 'Therapist',
  status: 'Status',
  settlement: 'Settlement',
  contact_name: 'Contact name',
  contact_phone: 'Contact phone',
  service_address: 'Address',
  booking_notes: 'Booking notes',
  customer_notes: 'Guest notes',
  cancelled_at: 'Cancelled at',
  cancellation_reason: 'Cancellation reason',
  cancelled_by: 'Cancelled by',
};

/** Why a booking is in conflict with the schedule or catalogue. */
export const CONFLICT_LABEL: Record<string, string> = {
  outside_business_hours: 'Outside opening hours',
  blackout: 'Business closed (blackout)',
  outside_shift: 'Outside the therapist\'s shift',
  on_break: 'During the therapist\'s break',
  time_off: 'Therapist on time off',
  service_inactive: 'Treatment no longer offered',
  therapist_inactive: 'Therapist no longer active',
  therapist_service_removed: 'Therapist no longer offers this treatment',
  zone_inactive: 'Area no longer served',
  service_changed: 'Treatment length changed',
  not_configured: 'Booking settings missing',
};

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday first, as staff plan their week. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];