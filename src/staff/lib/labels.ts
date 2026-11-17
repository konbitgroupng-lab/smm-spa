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
  bank_transfer: 'Bank transfer',
};

export const PAYMENT_LABEL: Record<PaymentState, string> = {
  paid: 'Paid online',
  deposit_paid: 'Deposit paid online',
  refund_due: 'Refund due',
  refunded: 'Refunded',
  unpaid: 'Not paid',
  to_collect: 'To collect',
  paid_offline: 'Paid offline',
  awaiting_transfer: 'Awaiting bank transfer',
  paid_transfer: 'Paid by bank transfer',
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
  'payment.refund_recorded': 'Refund recorded',
  'staff.invited': 'Invited to the staff app',
  'staff.role_changed': 'Role changed',
  'staff.activated': 'Account activated',
  'staff.deactivated': 'Account deactivated',
  'staff.therapist_linked': 'Linked to a therapist',
  'staff.therapist_unlinked': 'Unlinked from a therapist',
  'staff.profile_updated': 'Own name or phone updated',
  'settings.booking_rules_changed': 'Booking rules or business name changed',
  'settings.payment_settings_changed': 'Payment settings changed',
  'schedule.hours_changed': 'Opening hours changed',
  'schedule.therapist_week_changed': 'Weekly hours changed',
  'schedule.time_off_added': 'Time off added',
  'schedule.time_off_removed': 'Time off removed',
  'schedule.blackout_added': 'Closure added',
  'schedule.blackout_removed': 'Closure removed',
  'schedule.conflicts_accepted': 'Change saved despite affected bookings',
  'catalogue.service_created': 'Treatment created',
  'catalogue.service_updated': 'Treatment updated',
  'catalogue.package_items_changed': 'Package contents changed',
  'catalogue.therapist_created': 'Therapist created',
  'catalogue.therapist_updated': 'Therapist updated',
  'catalogue.therapist_services_changed': 'Therapist treatments changed',
  'catalogue.zone_created': 'Area created',
  'catalogue.zone_updated': 'Area updated',
  'appointment.transfer_received': 'Bank transfer received',
  'appointment.transfer_expired': 'Cancelled: bank transfer not confirmed in time',
  'settings.transfer_settings_changed': 'Bank transfer details changed',
  'content.faq_created': 'FAQ added',
  'content.faq_updated': 'FAQ edited',
  'content.faq_deleted': 'FAQ deleted',
  'content.testimonial_created': 'Testimonial added',
  'content.testimonial_updated': 'Testimonial edited',
  'content.testimonial_deleted': 'Testimonial deleted',
  'content.gallery_item_created': 'Gallery picture added',
  'content.gallery_item_updated': 'Gallery picture edited',
  'content.gallery_deleted': 'Gallery picture deleted',
  'content.announcement_created': 'Announcement added',
  'content.announcement_updated': 'Announcement edited',
  'content.announcement_deleted': 'Announcement deleted',
  'content.site_content_updated': 'Website text updated',
  'content.published': 'Shown on the website',
  'content.unpublished': 'Taken off the website',
  'content.reordered': 'Order changed',
  'content.media_added': 'Picture uploaded',
  'content.media_updated': 'Picture description changed',
  'content.media_removed': 'Picture removed from the library',
};

export const ENTITY_LABEL: Record<string, string> = {
  appointments: 'Booking', customers: 'Customer', payments: 'Payment', refund_records: 'Refund record', profiles: 'Staff account',
  therapists: 'Therapist', therapist_services: 'Therapist treatments', therapist_schedules: 'Shift', therapist_breaks: 'Break',
  therapist_time_off: 'Time off', blackout_dates: 'Closure', business_hours: 'Opening hours', business_settings: 'Settings',
  services: 'Treatment', service_package_items: 'Package contents', dispatch_zones: 'In-home area',
  faqs: 'FAQ', testimonials: 'Testimonial', gallery_items: 'Gallery picture', announcements: 'Announcement',
  site_content: 'Website text', media_assets: 'Picture',
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  initialized: 'Started', pending: 'Waiting for the provider', succeeded: 'Paid', failed: 'Failed', abandoned: 'Abandoned',
  refunded: 'Refunded', partially_refunded: 'Partly refunded',
};

export const REFUND_REASON_LABEL: Record<string, string> = {
  slot_retaken: 'Time taken by another guest before payment arrived', hold_released: 'Reservation released before payment arrived',
  slot_passed: 'Appointment time passed before payment arrived', amount_mismatch: 'Amount received differs from the booking',
  currency_mismatch: 'Paid in another currency', duplicate_payment: 'Booking already paid', hold_missing: 'Reservation missing',
  schedule_changed: 'Schedule changed before payment arrived', service_changed: 'Treatment changed before payment arrived',
  therapist_unavailable: 'Therapist no longer available', appointment_cancelled: 'Booking cancelled', zone_unavailable: 'Area no longer served',
};

export const REFUND_METHOD_LABEL: Record<string, string> = {
  provider_dashboard: 'Refunded in the payment provider\'s dashboard', bank_transfer: 'Bank transfer', cash: 'Cash',
};

export const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', therapist: 'Therapist' };

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
  refunded_minor: 'Refunded',
  refund_status: 'Refund status',
  needs_refund: 'Needs refund',
  needs_refund_reason: 'Refund reason',
  paid_minor: 'Paid',
  appointment_id: 'Booking',
  role: 'Role',
  is_active: 'Active',
  profile_id: 'Staff account',
  paid_at: 'Paid at',
  channel: 'Payment method',
  failure_reason: 'Failure reason',
  refund_reference: 'Refund reference',
  refund_reason: 'Refund note',
  full_name: 'Name',
  phone: 'Phone',
  staff_notes: 'Staff notes',
  email: 'Email',
  price_minor: 'Price',
  dispatch_fee_minor: 'Travel fee',
  fee_minor: 'Travel fee',
  duration_minutes: 'Length (minutes)',
  buffer_minutes: 'Buffer (minutes)',
  transfer_received_at: 'Transfer received',
  transfer_due_at: 'Transfer due by',
  transfer_amount_minor: 'Transfer amount',
  transfer_token: 'Guest page link',
  transfer_enabled: 'Bank transfer offered',
  bank_name: 'Bank',
  bank_account_number: 'Account number',
  bank_account_name: 'Account name',
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