import type { SupabaseClient } from '@supabase/supabase-js';
import { dbError } from './backend';

// Appointment and customer operations for the staff app. Every call is a
// database function that checks the caller's role and the record's version;
// nothing here decides what a user may do.
//
// Versions (`updatedAt`) are passed back exactly as received: strings with
// microseconds, never converted to Date.

export type AppointmentStatus = 'pending_payment' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
export type BookingSource = 'online' | 'phone' | 'whatsapp';
export type Settlement = 'online_payment' | 'pay_at_venue' | 'paid_offline';
export type PaymentState = 'paid' | 'deposit_paid' | 'refund_due' | 'refunded' | 'unpaid' | 'to_collect' | 'paid_offline';
export type LocationType = 'sanctuary' | 'mobile';

export interface AppointmentRow {
  id: string;
  reference: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  source: BookingSource;
  settlement: Settlement;
  paymentState: PaymentState;
  serviceName: string;
  therapistId: string;
  therapistName: string;
  locationType: LocationType;
  zoneName: string | null;
  customerId: string;
  customerName: string;
  contactName: string;
  contactPhone: string | null;
  totalMinor: number;
  currency: string;
  isDemo: boolean;
  updatedAt: string;
}

export interface PaymentSummary {
  provider: string;
  reference: string;
  kind: 'full' | 'deposit';
  status: string;
  amountMinor: number;
  paidMinor: number | null;
  refundedMinor: number;
  currency: string;
  paidAt: string | null;
  needsRefund: boolean;
  needsRefundReason: string | null;
  refundStatus: string;
  isTest: boolean;
  isDemo: boolean;
}

export interface HistoryEntry {
  occurredAt: string;
  action: string;
  actorKind: 'staff' | 'system';
  actorName: string | null;
  actorRole: string | null;
  changes: Record<string, { old?: unknown; new?: unknown; changed?: boolean }>;
  reason: string | null;
  context: Record<string, unknown>;
}

export interface AppointmentDetail {
  appointment: {
    id: string;
    reference: string;
    status: AppointmentStatus;
    startsAt: string;
    endsAt: string;
    source: BookingSource;
    settlement: Settlement;
    paymentState: PaymentState;
    serviceId: string;
    serviceName: string;
    therapistId: string;
    therapistName: string;
    locationType: LocationType;
    zoneName: string | null;
    serviceAddress: string | null;
    contactName: string | null;
    contactPhone: string | null;
    customerNotes: string | null;
    bookingNotes: string | null;
    priceMinor: number;
    dispatchFeeMinor: number;
    totalMinor: number;
    currency: string;
    cancelledAt: string | null;
    cancellationReason: string | null;
    createdByName: string | null;
    isDemo: boolean;
    createdAt: string;
    updatedAt: string;
  };
  customer: { id: string; fullName: string; email: string | null; phone: string | null };
  payments: PaymentSummary[];
  history: HistoryEntry[];
}

export interface AgendaItem {
  id: string;
  reference: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  serviceName: string;
  durationMinutes: number;
  locationType: LocationType;
  zoneName: string | null;
  serviceAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  customerNotes: string | null;
  bookingNotes: string | null;
  source: BookingSource;
  paymentState: 'paid' | 'deposit_paid' | 'to_collect';
  isDemo: boolean;
  updatedAt: string;
}

export interface Dashboard {
  today: string;
  todayTotal: number;
  todayRemaining: number;
  todayCompleted: number;
  todayNoShow: number;
  todayToCollect: number;
  awaitingOutcome: number;
  refundsFlagged: number;
  next7Days: number;
  scheduleConflicts: number;
}

export interface BookingOptions {
  services: { id: string; name: string; durationMinutes: number; priceMinor: number; currency: string }[];
  therapists: { id: string; name: string; serviceIds: string[] }[];
  zones: { id: string; name: string; feeMinor: number }[];
  timezone: string;
}

export interface Slot {
  therapistId: string;
  startsAt: string;
}

export interface CustomerRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  appointmentCount: number;
  lastVisit: string | null;
  nextVisit: string | null;
  isDemo: boolean;
}

export interface CustomerDetail {
  customer: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    staffNotes: string | null;
    isDemo: boolean;
    createdAt: string;
    updatedAt: string;
  };
  appointments: {
    id: string;
    reference: string;
    startsAt: string;
    status: AppointmentStatus;
    source: BookingSource;
    settlement: Settlement;
    paymentState: PaymentState;
    serviceName: string;
    therapistName: string;
    contactName: string | null;
    contactPhone: string | null;
    totalMinor: number;
    currency: string;
  }[];
}

export interface NewBooking {
  source: 'phone' | 'whatsapp';
  settlement: 'pay_at_venue' | 'paid_offline';
  serviceId: string;
  startsAt: string;
  therapistId: string | null;
  locationType: LocationType;
  dispatchZoneId: string | null;
  serviceAddress: string | null;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  contactName: string | null;
  contactPhone: string | null;
  bookingNotes: string | null;
  reason: string;
}

export interface CustomerInput {
  fullName: string;
  email: string | null;
  phone: string | null;
  staffNotes: string | null;
}

// --- Schedule and catalogue (Phase 5c) -------------------------------------

export interface WeekPeriod {
  dayOfWeek: number; // 0 = Sunday
  startTime: string; // HH:MM
  endTime: string;
}

export interface ScheduleOverview {
  hours: { dayOfWeek: number; isClosed: boolean; opensAt: string | null; closesAt: string | null }[];
  hoursVersion: string;
  therapists: { id: string; name: string; isActive: boolean; weekVersion: string; shifts: WeekPeriod[]; breaks: WeekPeriod[] }[];
  timeOff: { id: string; therapistId: string; therapistName: string; startsAt: string; endsAt: string; note: string | null }[];
  blackouts: { id: string; startsAt: string; endsAt: string; note: string | null }[];
  rules: {
    businessName: string; timezone: string; holdMinutes: number; minLeadMinutes: number; maxAdvanceDays: number;
    slotIntervalMinutes: number; defaultBufferMinutes: number; updatedAt: string;
  };
  conflictCount: number;
}

export interface CatalogueService {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  benefits: string[];
  durationMinutes: number;
  bufferMinutes: number;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  currency: string;
  isPackage: boolean;
  isPopular: boolean;
  isActive: boolean;
  sortOrder: number;
  updatedAt: string;
  futureAppointments: number;
  liveReservations: number;
  items: { serviceId: string; name: string }[];
  itemsVersion: string;
}

export interface CatalogueTherapist {
  id: string;
  displayName: string;
  title: string;
  specialty: string;
  bio: string;
  isActive: boolean;
  sortOrder: number;
  updatedAt: string;
  hasAccount: boolean;
  serviceIds: string[];
  servicesVersion: string;
  futureAppointments: number;
}

export interface CatalogueZone {
  id: string;
  key: string;
  name: string;
  feeMinor: number;
  isActive: boolean;
  sortOrder: number;
  updatedAt: string;
  futureAppointments: number;
}

export interface Catalogue {
  services: CatalogueService[];
  therapists: CatalogueTherapist[];
  zones: CatalogueZone[];
}

export interface ConflictRow {
  id: string;
  reference: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  serviceName: string;
  therapistId: string;
  therapistName: string;
  contactName: string | null;
  locationType: LocationType;
  zoneName: string | null;
  reasons: string[];
}

/** Bookings a change would put in conflict (from confirmation_required, or after a confirmed change). */
export interface ConflictSummary {
  appointments: { id: string; reference: string; startsAt: string; serviceName: string; therapistName: string; contactName: string | null; reasons: string[] }[];
  reservations: number;
}

/** How a schedule or catalogue change is sent: confirm = keep the affected bookings as they are. */
export interface ChangeOptions {
  reason: string | null;
  confirm: boolean;
}

export interface ServiceInput {
  slug: string;
  name: string;
  category: string;
  description: string;
  benefits: string[];
  durationMinutes: number;
  bufferMinutes: number;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  isPopular: boolean;
  isActive: boolean;
  sortOrder: number;
  isPackage: boolean;
}

export interface TherapistInput {
  displayName: string;
  title: string;
  specialty: string;
  bio: string;
  isActive: boolean;
  sortOrder: number;
}

export interface ZoneInput {
  key: string;
  name: string;
  feeMinor: number;
  isActive: boolean;
  sortOrder: number;
}

export interface BookingRulesInput {
  holdMinutes: number;
  minLeadMinutes: number;
  maxAdvanceDays: number;
  slotIntervalMinutes: number;
  defaultBufferMinutes: number;
}

/** The bookings listed in a confirmation_required error. */
export function conflictsOf(err: unknown): ConflictSummary | null {
  if (!(err instanceof Error) || (err as any).code !== 'confirmation_required' || !(err as any).detail) return null;
  try {
    return mapSummary(JSON.parse((err as any).detail));
  } catch {
    return null;
  }
}

function mapSummary(s: any): ConflictSummary {
  return {
    appointments: (s?.appointments ?? []).map((a: any) => ({
      id: a.id, reference: a.reference, startsAt: a.starts_at, serviceName: a.service_name, therapistName: a.therapist_name,
      contactName: a.contact_name, reasons: a.reasons,
    })),
    reservations: Number(s?.reservations ?? 0),
  };
}

export interface StaffOps {
  dashboard(): Promise<Dashboard>;
  appointments(from: string, to: string, therapistId?: string | null): Promise<AppointmentRow[]>;
  appointmentDetail(id: string): Promise<AppointmentDetail>;
  agenda(from: string, to: string): Promise<AgendaItem[]>;
  bookingOptions(): Promise<BookingOptions>;
  availableSlots(serviceId: string, date: string, therapistId?: string | null): Promise<Slot[]>;
  createBooking(input: NewBooking): Promise<{ id: string }>;
  reschedule(id: string, startsAt: string, reason: string, version: string, therapistId: string | null, override: boolean): Promise<void>;
  cancel(id: string, reason: string, version: string): Promise<{ refundFlagged: number; settlement: Settlement }>;
  setStatus(id: string, status: 'completed' | 'no_show' | 'confirmed', version: string, reason?: string | null): Promise<void>;
  updateBookingDetails(id: string, version: string, input: {
    contactName: string; contactPhone: string; serviceAddress: string | null; bookingNotes: string | null; reason: string | null;
  }): Promise<void>;
  setSettlement(id: string, settlement: 'pay_at_venue' | 'paid_offline', reason: string, version: string): Promise<void>;
  customers(query: string, limit: number, offset: number): Promise<{ rows: CustomerRow[]; total: number }>;
  customerDetail(id: string): Promise<CustomerDetail>;
  createCustomer(input: CustomerInput): Promise<{ id: string }>;
  updateCustomer(id: string, version: string, input: CustomerInput & { reason: string | null }): Promise<void>;

  scheduleOverview(): Promise<ScheduleOverview>;
  catalogue(): Promise<Catalogue>;
  scheduleConflicts(): Promise<ConflictRow[]>;
  setBusinessHours(hours: ScheduleOverview['hours'], version: string, opts: ChangeOptions): Promise<ConflictSummary>;
  setTherapistWeek(therapistId: string, shifts: WeekPeriod[], breaks: WeekPeriod[], version: string, opts: ChangeOptions): Promise<ConflictSummary>;
  addTimeOff(therapistId: string, startsAt: string, endsAt: string, note: string | null, opts: ChangeOptions): Promise<ConflictSummary>;
  removeTimeOff(id: string, reason: string | null): Promise<void>;
  addBlackout(startsAt: string, endsAt: string, note: string | null, opts: ChangeOptions): Promise<ConflictSummary>;
  removeBlackout(id: string, reason: string | null): Promise<void>;
  updateBookingRules(version: string, rules: BookingRulesInput, reason: string): Promise<void>;
  saveService(id: string | null, version: string | null, input: ServiceInput, opts: ChangeOptions): Promise<{ id: string; conflicts: ConflictSummary }>;
  setPackageItems(packageId: string, serviceIds: string[], version: string, reason: string | null): Promise<void>;
  saveTherapist(id: string | null, version: string | null, input: TherapistInput, opts: ChangeOptions): Promise<{ id: string; conflicts: ConflictSummary }>;
  setTherapistServices(therapistId: string, serviceIds: string[], version: string, opts: ChangeOptions): Promise<ConflictSummary>;
  saveZone(id: string | null, version: string | null, input: ZoneInput, opts: ChangeOptions): Promise<{ id: string; conflicts: ConflictSummary }>;
}

const weekToDb = (periods: WeekPeriod[]) =>
  periods.map((p) => ({ day_of_week: p.dayOfWeek, start_time: p.startTime, end_time: p.endTime }));
const weekFromDb = (periods: any[]): WeekPeriod[] =>
  periods.map((p) => ({ dayOfWeek: p.day_of_week, startTime: p.start_time, endTime: p.end_time }));

// ---------------------------------------------------------------------------
// Supabase implementation

export function createSupabaseOps(client: SupabaseClient): StaffOps {
  async function call<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw dbError(error);
    return data as T;
  }

  return {
    async dashboard() {
      const d = await call('staff_dashboard');
      return {
        today: d.today, todayTotal: d.today_total, todayRemaining: d.today_remaining, todayCompleted: d.today_completed,
        todayNoShow: d.today_no_show, todayToCollect: d.today_to_collect, awaitingOutcome: d.awaiting_outcome,
        refundsFlagged: d.refunds_flagged, next7Days: d.next_7_days, scheduleConflicts: d.schedule_conflicts ?? 0,
      };
    },

    async appointments(from, to, therapistId = null) {
      const rows = await call<any[]>('staff_appointments', { p_from: from, p_to: to, p_therapist_id: therapistId });
      return rows.map((r) => ({
        id: r.appointment_id, reference: r.reference, startsAt: r.starts_at, endsAt: r.ends_at, status: r.status,
        source: r.source, settlement: r.settlement, paymentState: r.payment_state, serviceName: r.service_name,
        therapistId: r.therapist_id, therapistName: r.therapist_name, locationType: r.location_type, zoneName: r.zone_name,
        customerId: r.customer_id, customerName: r.customer_name, contactName: r.contact_name, contactPhone: r.contact_phone,
        totalMinor: Number(r.total_minor), currency: r.currency, isDemo: r.is_demo, updatedAt: r.updated_at,
      }));
    },

    async appointmentDetail(id) {
      const d = await call('staff_appointment_detail', { p_appointment_id: id });
      const a = d.appointment;
      return {
        appointment: {
          id: a.id, reference: a.reference, status: a.status, startsAt: a.starts_at, endsAt: a.ends_at, source: a.source,
          settlement: a.settlement, paymentState: a.payment_state, serviceId: a.service_id, serviceName: a.service_name,
          therapistId: a.therapist_id, therapistName: a.therapist_name, locationType: a.location_type, zoneName: a.zone_name,
          serviceAddress: a.service_address, contactName: a.contact_name, contactPhone: a.contact_phone,
          customerNotes: a.customer_notes, bookingNotes: a.booking_notes, priceMinor: Number(a.price_minor),
          dispatchFeeMinor: Number(a.dispatch_fee_minor), totalMinor: Number(a.total_minor), currency: a.currency,
          cancelledAt: a.cancelled_at, cancellationReason: a.cancellation_reason, createdByName: a.created_by_name || null,
          isDemo: a.is_demo, createdAt: a.created_at, updatedAt: a.updated_at,
        },
        customer: { id: d.customer.id, fullName: d.customer.full_name, email: d.customer.email, phone: d.customer.phone },
        payments: d.payments.map((p: any) => ({
          provider: p.provider, reference: p.reference, kind: p.kind, status: p.status, amountMinor: Number(p.amount_minor),
          paidMinor: p.paid_minor === null ? null : Number(p.paid_minor), refundedMinor: Number(p.refunded_minor),
          currency: p.currency, paidAt: p.paid_at, needsRefund: p.needs_refund, needsRefundReason: p.needs_refund_reason,
          refundStatus: p.refund_status, isTest: p.is_test, isDemo: p.is_demo,
        })),
        history: d.history.map((h: any) => ({
          occurredAt: h.occurred_at, action: h.action, actorKind: h.actor_kind, actorName: h.actor_name || null,
          actorRole: h.actor_role, changes: h.changes ?? {}, reason: h.reason, context: h.context ?? {},
        })),
      };
    },

    async agenda(from, to) {
      const rows = await call<any[]>('therapist_agenda', { p_from: from, p_to: to });
      return rows.map((r) => ({
        id: r.appointment_id, reference: r.reference, startsAt: r.starts_at, endsAt: r.ends_at, status: r.status,
        serviceName: r.service_name, durationMinutes: r.duration_minutes, locationType: r.location_type, zoneName: r.zone_name,
        serviceAddress: r.service_address, contactName: r.contact_name, contactPhone: r.contact_phone,
        customerNotes: r.customer_notes, bookingNotes: r.booking_notes, source: r.source, paymentState: r.payment_state,
        isDemo: r.is_demo, updatedAt: r.updated_at,
      }));
    },

    async bookingOptions() {
      const o = await call('staff_booking_options');
      return {
        services: o.services.map((s: any) => ({ id: s.id, name: s.name, durationMinutes: s.duration_minutes, priceMinor: Number(s.price_minor), currency: s.currency })),
        therapists: o.therapists.map((t: any) => ({ id: t.id, name: t.name, serviceIds: t.service_ids })),
        zones: o.zones.map((z: any) => ({ id: z.id, name: z.name, feeMinor: Number(z.fee_minor) })),
        timezone: o.timezone,
      };
    },

    async availableSlots(serviceId, date, therapistId = null) {
      const rows = await call<any[]>('get_available_slots', { p_service_id: serviceId, p_date: date, p_therapist_id: therapistId });
      return rows.map((r) => ({ therapistId: r.therapist_id, startsAt: r.starts_at }));
    },

    async createBooking(b) {
      const row = await call('staff_create_booking', {
        p_source: b.source, p_settlement: b.settlement, p_service_id: b.serviceId, p_starts_at: b.startsAt, p_reason: b.reason,
        p_therapist_id: b.therapistId, p_location_type: b.locationType, p_dispatch_zone_id: b.dispatchZoneId,
        p_service_address: b.serviceAddress, p_customer_id: b.customerId, p_customer_name: b.customerName,
        p_customer_email: b.customerEmail, p_customer_phone: b.customerPhone, p_contact_name: b.contactName,
        p_contact_phone: b.contactPhone, p_booking_notes: b.bookingNotes,
      });
      return { id: row.id };
    },

    async reschedule(id, startsAt, reason, version, therapistId, override) {
      await call('staff_reschedule_appointment', {
        p_appointment_id: id, p_starts_at: startsAt, p_reason: reason, p_expected_updated_at: version,
        p_therapist_id: therapistId, p_override: override,
      });
    },

    async cancel(id, reason, version) {
      const r = await call('staff_cancel_appointment', { p_appointment_id: id, p_reason: reason, p_expected_updated_at: version });
      return { refundFlagged: r.refund_flagged, settlement: r.settlement };
    },

    async setStatus(id, status, version, reason = null) {
      await call('staff_set_appointment_status', { p_appointment_id: id, p_status: status, p_expected_updated_at: version, p_reason: reason });
    },

    async updateBookingDetails(id, version, input) {
      await call('staff_update_booking_details', {
        p_appointment_id: id, p_expected_updated_at: version, p_contact_name: input.contactName, p_contact_phone: input.contactPhone,
        p_service_address: input.serviceAddress, p_booking_notes: input.bookingNotes, p_reason: input.reason,
      });
    },

    async setSettlement(id, settlement, reason, version) {
      await call('staff_set_settlement', { p_appointment_id: id, p_settlement: settlement, p_reason: reason, p_expected_updated_at: version });
    },

    async customers(query, limit, offset) {
      const rows = await call<any[]>('staff_customer_directory', { p_query: query || null, p_limit: limit, p_offset: offset });
      return {
        rows: rows.map((r) => ({
          id: r.customer_id, fullName: r.full_name, email: r.email, phone: r.phone, appointmentCount: Number(r.appointment_count),
          lastVisit: r.last_visit, nextVisit: r.next_visit, isDemo: r.is_demo,
        })),
        total: rows.length ? Number(rows[0].total_count) : 0,
      };
    },

    async customerDetail(id) {
      const d = await call('staff_customer_detail', { p_customer_id: id });
      const c = d.customer;
      return {
        customer: {
          id: c.id, fullName: c.full_name, email: c.email, phone: c.phone, staffNotes: c.staff_notes, isDemo: c.is_demo,
          createdAt: c.created_at, updatedAt: c.updated_at,
        },
        appointments: d.appointments.map((a: any) => ({
          id: a.id, reference: a.reference, startsAt: a.starts_at, status: a.status, source: a.source, settlement: a.settlement,
          paymentState: a.payment_state, serviceName: a.service_name, therapistName: a.therapist_name,
          contactName: a.contact_name, contactPhone: a.contact_phone, totalMinor: Number(a.total_minor), currency: a.currency,
        })),
      };
    },

    async createCustomer(input) {
      const row = await call('staff_create_customer', {
        p_full_name: input.fullName, p_email: input.email, p_phone: input.phone, p_staff_notes: input.staffNotes,
      });
      return { id: row.id };
    },

    async updateCustomer(id, version, input) {
      await call('staff_update_customer', {
        p_customer_id: id, p_expected_updated_at: version, p_full_name: input.fullName, p_email: input.email,
        p_phone: input.phone, p_staff_notes: input.staffNotes, p_reason: input.reason,
      });
    },

    async scheduleOverview() {
      const o = await call('staff_schedule_overview');
      const r = o.rules;
      return {
        hours: o.hours.map((h: any) => ({ dayOfWeek: h.day_of_week, isClosed: h.is_closed, opensAt: h.opens_at, closesAt: h.closes_at })),
        hoursVersion: o.hours_version,
        therapists: o.therapists.map((t: any) => ({
          id: t.id, name: t.name, isActive: t.is_active, weekVersion: t.week_version, shifts: weekFromDb(t.shifts), breaks: weekFromDb(t.breaks),
        })),
        timeOff: o.time_off.map((x: any) => ({ id: x.id, therapistId: x.therapist_id, therapistName: x.therapist_name, startsAt: x.starts_at, endsAt: x.ends_at, note: x.note })),
        blackouts: o.blackouts.map((x: any) => ({ id: x.id, startsAt: x.starts_at, endsAt: x.ends_at, note: x.note })),
        rules: {
          businessName: r.business_name, timezone: r.timezone, holdMinutes: r.hold_minutes, minLeadMinutes: r.min_lead_minutes,
          maxAdvanceDays: r.max_advance_days, slotIntervalMinutes: r.slot_interval_minutes, defaultBufferMinutes: r.default_buffer_minutes,
          updatedAt: r.updated_at,
        },
        conflictCount: Number(o.conflict_count),
      };
    },

    async catalogue() {
      const c = await call('staff_catalogue');
      return {
        services: c.services.map((s: any) => ({
          id: s.id, slug: s.slug, name: s.name, category: s.category, description: s.description, benefits: s.benefits ?? [],
          durationMinutes: s.duration_minutes, bufferMinutes: s.buffer_minutes, priceMinor: Number(s.price_minor),
          compareAtPriceMinor: s.compare_at_price_minor === null ? null : Number(s.compare_at_price_minor), currency: s.currency,
          isPackage: s.is_package, isPopular: s.is_popular, isActive: s.is_active, sortOrder: s.sort_order, updatedAt: s.updated_at,
          futureAppointments: Number(s.future_appointments), liveReservations: Number(s.live_reservations),
          items: s.items.map((i: any) => ({ serviceId: i.service_id, name: i.name })), itemsVersion: s.items_version,
        })),
        therapists: c.therapists.map((t: any) => ({
          id: t.id, displayName: t.display_name, title: t.title, specialty: t.specialty, bio: t.bio, isActive: t.is_active,
          sortOrder: t.sort_order, updatedAt: t.updated_at, hasAccount: t.has_account, serviceIds: t.service_ids,
          servicesVersion: t.services_version, futureAppointments: Number(t.future_appointments),
        })),
        zones: c.zones.map((z: any) => ({
          id: z.id, key: z.key, name: z.name, feeMinor: Number(z.fee_minor), isActive: z.is_active, sortOrder: z.sort_order,
          updatedAt: z.updated_at, futureAppointments: Number(z.future_appointments),
        })),
      };
    },

    async scheduleConflicts() {
      const rows = await call<any[]>('staff_schedule_conflicts');
      return rows.map((r) => ({
        id: r.appointment_id, reference: r.reference, startsAt: r.starts_at, endsAt: r.ends_at, status: r.status,
        serviceName: r.service_name, therapistId: r.therapist_id, therapistName: r.therapist_name, contactName: r.contact_name,
        locationType: r.location_type, zoneName: r.zone_name, reasons: r.reasons,
      }));
    },

    async setBusinessHours(hours, version, opts) {
      const r = await call('staff_set_business_hours', {
        p_hours: hours.map((h) => ({ day_of_week: h.dayOfWeek, is_closed: h.isClosed, opens_at: h.opensAt, closes_at: h.closesAt })),
        p_expected_version: version, p_reason: opts.reason, p_confirm: opts.confirm,
      });
      return mapSummary(r.conflicts);
    },

    async setTherapistWeek(therapistId, shifts, breaks, version, opts) {
      const r = await call('staff_set_therapist_week', {
        p_therapist_id: therapistId, p_shifts: weekToDb(shifts), p_breaks: weekToDb(breaks), p_expected_version: version,
        p_reason: opts.reason, p_confirm: opts.confirm,
      });
      return mapSummary(r.conflicts);
    },

    async addTimeOff(therapistId, startsAt, endsAt, note, opts) {
      const r = await call('staff_add_time_off', {
        p_therapist_id: therapistId, p_starts_at: startsAt, p_ends_at: endsAt, p_note: note, p_reason: opts.reason, p_confirm: opts.confirm,
      });
      return mapSummary(r.conflicts);
    },

    async removeTimeOff(id, reason) {
      await call('staff_remove_time_off', { p_time_off_id: id, p_reason: reason });
    },

    async addBlackout(startsAt, endsAt, note, opts) {
      const r = await call('staff_add_blackout', { p_starts_at: startsAt, p_ends_at: endsAt, p_note: note, p_reason: opts.reason, p_confirm: opts.confirm });
      return mapSummary(r.conflicts);
    },

    async removeBlackout(id, reason) {
      await call('staff_remove_blackout', { p_blackout_id: id, p_reason: reason });
    },

    async updateBookingRules(version, rules, reason) {
      await call('staff_update_booking_rules', {
        p_expected_updated_at: version, p_reason: reason, p_hold_minutes: rules.holdMinutes, p_min_lead_minutes: rules.minLeadMinutes,
        p_max_advance_days: rules.maxAdvanceDays, p_slot_interval_minutes: rules.slotIntervalMinutes,
        p_default_buffer_minutes: rules.defaultBufferMinutes,
      });
    },

    async saveService(id, version, s, opts) {
      const r = await call('staff_save_service', {
        p_service_id: id, p_expected_updated_at: version, p_reason: opts.reason, p_confirm: opts.confirm,
        p_fields: {
          slug: s.slug, name: s.name, category: s.category, description: s.description, benefits: s.benefits,
          duration_minutes: s.durationMinutes, buffer_minutes: s.bufferMinutes, price_minor: s.priceMinor,
          compare_at_price_minor: s.compareAtPriceMinor, is_popular: s.isPopular, is_active: s.isActive, sort_order: s.sortOrder,
          is_package: s.isPackage,
        },
      });
      return { id: r.id, conflicts: mapSummary(r.conflicts) };
    },

    async setPackageItems(packageId, serviceIds, version, reason) {
      await call('staff_set_package_items', { p_package_id: packageId, p_service_ids: serviceIds, p_expected_version: version, p_reason: reason });
    },

    async saveTherapist(id, version, t, opts) {
      const r = await call('staff_save_therapist', {
        p_therapist_id: id, p_expected_updated_at: version, p_reason: opts.reason, p_confirm: opts.confirm,
        p_fields: { display_name: t.displayName, title: t.title, specialty: t.specialty, bio: t.bio, is_active: t.isActive, sort_order: t.sortOrder },
      });
      return { id: r.id, conflicts: mapSummary(r.conflicts) };
    },

    async setTherapistServices(therapistId, serviceIds, version, opts) {
      const r = await call('staff_set_therapist_services', {
        p_therapist_id: therapistId, p_service_ids: serviceIds, p_expected_version: version, p_reason: opts.reason, p_confirm: opts.confirm,
      });
      return mapSummary(r.conflicts);
    },

    async saveZone(id, version, z, opts) {
      const r = await call('staff_save_zone', {
        p_zone_id: id, p_expected_updated_at: version, p_reason: opts.reason, p_confirm: opts.confirm,
        p_fields: { key: z.key, name: z.name, fee_minor: z.feeMinor, is_active: z.isActive, sort_order: z.sortOrder },
      });
      return { id: r.id, conflicts: mapSummary(r.conflicts) };
    },
  };
}
