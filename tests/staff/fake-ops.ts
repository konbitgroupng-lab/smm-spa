import { vi } from 'vitest';
import type {
  AgendaItem, AppointmentDetail, AppointmentRow, BookingOptions, Catalogue, ConflictRow, CustomerDetail, CustomerRow, Dashboard,
  PaymentDetail, PaymentRow, ScheduleOverview, Settings, StaffList, StaffOps, AuditEntry,
} from '../../src/staff/lib/ops';

// A scripted StaffOps for screen tests. Each method is a vi.fn returning the
// fixtures below; tests override them as needed. What each role may do is
// proven in the database tests, not here.

export const V1 = '2026-10-08 09:00:00.123456+00';

export function appointmentRow(overrides: Partial<AppointmentRow> = {}): AppointmentRow {
  return {
    id: 'appt-1', reference: 'SMM-AAAA1111', startsAt: '2026-10-12T09:00:00Z', endsAt: '2026-10-12T10:00:00Z',
    status: 'confirmed', source: 'phone', settlement: 'pay_at_venue', paymentState: 'to_collect', serviceName: 'Swedish Massage',
    therapistId: 't-1', therapistName: 'Senior Massage Therapist', locationType: 'sanctuary', zoneName: null,
    customerId: 'c-1', customerName: 'Ada Master', contactName: 'Ada Contact', contactPhone: '+2348030000001',
    totalMinor: 4000000, currency: 'NGN', isDemo: false, updatedAt: V1, ...overrides,
  };
}

export function appointmentDetail(overrides: Partial<AppointmentDetail['appointment']> = {}, extra: Partial<AppointmentDetail> = {}): AppointmentDetail {
  return {
    appointment: {
      id: 'appt-1', reference: 'SMM-AAAA1111', status: 'confirmed', startsAt: '2030-10-14T09:00:00Z', endsAt: '2030-10-14T10:00:00Z',
      source: 'phone', settlement: 'pay_at_venue', paymentState: 'to_collect', serviceId: 's-1', serviceName: 'Swedish Massage',
      therapistId: 't-1', therapistName: 'Senior Massage Therapist', locationType: 'sanctuary', zoneName: null, serviceAddress: null,
      contactName: 'Ada Contact', contactPhone: '+2348030000001', customerNotes: 'Sore shoulder', bookingNotes: 'Side entrance',
      priceMinor: 4000000, dispatchFeeMinor: 0, totalMinor: 4000000, currency: 'NGN', cancelledAt: null, cancellationReason: null,
      createdByName: 'Admin Person', isDemo: false, createdAt: '2026-10-08T09:00:00Z', updatedAt: V1, ...overrides,
    },
    customer: { id: 'c-1', fullName: 'Ada Master', email: 'ada@example.com', phone: '+2348030000009' },
    payments: [],
    history: [{
      occurredAt: '2026-10-08T09:00:00Z', action: 'appointment.created_by_staff', actorKind: 'staff', actorName: 'Admin Person',
      actorRole: 'admin', changes: {}, reason: 'Called to book', context: { source: 'phone' },
    }],
    ...extra,
  };
}

export const OPTIONS: BookingOptions = {
  services: [
    { id: 's-1', name: 'Swedish Massage', durationMinutes: 60, priceMinor: 4000000, currency: 'NGN' },
    { id: 's-2', name: 'Premium Facial Treatment', durationMinutes: 60, priceMinor: 4500000, currency: 'NGN' },
  ],
  therapists: [
    { id: 't-1', name: 'Senior Massage Therapist', serviceIds: ['s-1', 's-2'] },
    { id: 't-2', name: 'Lead Spa Therapist', serviceIds: ['s-1'] },
  ],
  zones: [{ id: 'z-1', name: 'Surulere / Yaba', feeMinor: 300000 }],
  timezone: 'Africa/Lagos',
};

export const DASHBOARD: Dashboard = {
  today: '2026-10-08', todayTotal: 5, todayRemaining: 3, todayCompleted: 1, todayNoShow: 1, todayToCollect: 2,
  awaitingOutcome: 1, refundsFlagged: 2, next7Days: 12, scheduleConflicts: 1, paymentsWaiting: 0,
};

export function agendaItem(overrides: Partial<AgendaItem> = {}): AgendaItem {
  return {
    id: 'appt-9', reference: 'SMM-BBBB2222', startsAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + 30 * 60_000).toISOString(), status: 'confirmed', serviceName: 'Swedish Massage', durationMinutes: 60,
    locationType: 'mobile', zoneName: 'Surulere / Yaba', serviceAddress: '4 Allen Avenue', contactName: 'Bola Contact',
    contactPhone: '+234 803 000 0002', customerNotes: 'Bad knee', bookingNotes: 'Bring the big table', source: 'whatsapp',
    paymentState: 'to_collect', isDemo: false, updatedAt: V1, ...overrides,
  };
}

export const CUSTOMER_ROWS: CustomerRow[] = [
  { id: 'c-1', fullName: 'Ada Master', email: 'ada@example.com', phone: '+2348030000009', appointmentCount: 3, lastVisit: null, nextVisit: '2026-10-12T09:00:00Z', isDemo: false },
  { id: 'c-2', fullName: 'Bola Walkin', email: null, phone: '+2348030000010', appointmentCount: 0, lastVisit: null, nextVisit: null, isDemo: false },
];

export function customerDetail(): CustomerDetail {
  return {
    customer: { id: 'c-1', fullName: 'Ada Master', email: 'ada@example.com', phone: '+2348030000009', staffNotes: 'Prefers mornings',
      isDemo: false, createdAt: '2026-10-01T09:00:00Z', updatedAt: V1 },
    appointments: [{
      id: 'appt-1', reference: 'SMM-AAAA1111', startsAt: '2026-10-12T09:00:00Z', status: 'confirmed', source: 'phone',
      settlement: 'pay_at_venue', paymentState: 'to_collect', serviceName: 'Swedish Massage', therapistName: 'Senior Massage Therapist',
      contactName: 'Ada Contact', contactPhone: '+2348030000001', totalMinor: 4000000, currency: 'NGN',
    }],
  };
}


const WEEK = [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '20:00' }));
const BREAKS = [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '13:00', endTime: '14:00' }));

export function scheduleOverview(): ScheduleOverview {
  return {
    hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, isClosed: false, opensAt: '09:00', closesAt: '21:00' })),
    hoursVersion: 'hours-v1',
    therapists: [
      { id: 't-1', name: 'Senior Massage Therapist', isActive: true, weekVersion: 'week-t1', shifts: WEEK, breaks: BREAKS },
      { id: 't-2', name: 'Lead Spa Therapist', isActive: true, weekVersion: 'week-t2', shifts: WEEK, breaks: BREAKS },
    ],
    timeOff: [{ id: 'off-1', therapistId: 't-2', therapistName: 'Lead Spa Therapist', startsAt: '2026-11-02T08:00:00Z', endsAt: '2026-11-06T20:00:00Z', note: 'Annual leave' }],
    blackouts: [{ id: 'bo-1', startsAt: '2026-12-24T23:00:00Z', endsAt: '2026-12-25T23:00:00Z', note: 'Christmas Day' }],
    rules: { businessName: 'SMM', timezone: 'Africa/Lagos', holdMinutes: 10, minLeadMinutes: 120, maxAdvanceDays: 60, slotIntervalMinutes: 30, defaultBufferMinutes: 15, updatedAt: V1 },
    conflictCount: 1,
  };
}

export function catalogue(): Catalogue {
  const service = (id: string, name: string, extra: Partial<Catalogue['services'][number]> = {}) => ({
    id, slug: name.toLowerCase().replace(/ /g, '-'), name, category: 'Relaxation', description: 'A treatment.', benefits: ['Calm'],
    durationMinutes: 60, bufferMinutes: 15, priceMinor: 4000000, compareAtPriceMinor: null, currency: 'NGN', isPackage: false,
    isPopular: false, isActive: true, sortOrder: 1, updatedAt: V1, futureAppointments: 0, liveReservations: 0, items: [], itemsVersion: 'items-v0', ...extra,
  });
  return {
    services: [
      service('s-1', 'Swedish Massage', { futureAppointments: 3 }),
      service('s-2', 'Hot Stone Therapy', { sortOrder: 2, priceMinor: 5000000 }),
      service('s-3', 'Thai Massage', { sortOrder: 3, isActive: false }),
      service('p-1', 'Essential Escape', { isPackage: true, durationMinutes: 120, priceMinor: 8000000, items: [{ serviceId: 's-1', name: 'Swedish Massage' }], itemsVersion: 'items-v1' }),
    ],
    therapists: [
      { id: 't-1', displayName: 'Senior Massage Therapist', title: 'Swedish', specialty: 'Relaxation', bio: 'Calm hands.', isActive: true, sortOrder: 1,
        updatedAt: V1, hasAccount: true, serviceIds: ['s-1', 's-2'], servicesVersion: 'svc-t1', futureAppointments: 4 },
    ],
    zones: [{ id: 'z-1', key: 'mainland', name: 'Surulere / Yaba', feeMinor: 300000, isActive: true, sortOrder: 1, updatedAt: V1, futureAppointments: 2 }],
  };
}

export const CONFLICTS: ConflictRow[] = [{
  id: 'appt-7', reference: 'SMM-CCCC3333', startsAt: '2026-10-21T09:00:00Z', endsAt: '2026-10-21T10:00:00Z', status: 'confirmed',
  serviceName: 'Swedish Massage', therapistId: 't-1', therapistName: 'Senior Massage Therapist', contactName: 'Conflict Guest',
  locationType: 'sanctuary', zoneName: null, reasons: ['outside_shift', 'time_off'],
}];

const NO_CONFLICTS = { appointments: [], reservations: 0 };
export function paymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'pay-1', provider: 'mock', reference: 'SMMP-ABC123', kind: 'full', status: 'succeeded', amountMinor: 4000000, paidMinor: 4000000,
    refundedMinor: 0, refundableMinor: 4000000, currency: 'NGN', createdAt: '2026-10-08T09:00:00Z', paidAt: '2026-10-08T09:02:00Z',
    needsRefund: true, needsRefundReason: 'appointment_cancelled', needsRefundDetail: null, refundStatus: 'none', isDemo: true, isTest: true,
    appointmentId: 'appt-1', appointmentReference: 'SMM-AAAA1111', startsAt: '2026-10-12T09:00:00Z', serviceName: 'Swedish Massage',
    guestName: 'Refund Guest', updatedAt: V1, ...overrides,
  };
}

export function paymentDetail(overrides: Partial<PaymentDetail['payment']> = {}): PaymentDetail {
  return {
    payment: { ...paymentRow(), bookingTotalMinor: 4000000, verifiedAt: '2026-10-08T09:02:00Z', channel: 'card', failureReason: null,
      refundReference: null, refundRequestedAt: null, refundProcessedAt: null, refundError: null, ...overrides },
    booking: { appointmentId: 'appt-1', reference: 'SMM-AAAA1111', status: 'cancelled', startsAt: '2026-10-12T09:00:00Z', serviceName: 'Swedish Massage', therapistName: 'Senior Massage Therapist' },
    reservation: null,
    guest: { customerId: 'c-1', fullName: 'Ada Master', email: 'ada@example.com', phone: '+2348030000009', contactName: 'Refund Guest' },
    refunds: [],
    events: [{ eventType: 'charge.success', receivedAt: '2026-10-08T09:02:00Z', processedAt: '2026-10-08T09:02:01Z', processingError: null }],
    history: [{ occurredAt: '2026-10-08T09:02:00Z', action: 'update', actorKind: 'system', actorName: null, actorRole: null,
      changes: { status: { old: 'pending', new: 'succeeded' }, paid_minor: { old: null, new: 4000000 } }, reason: null, context: {} }],
  };
}

export const SETTINGS: Settings = {
  businessName: 'SMM', timezone: 'Africa/Lagos', currency: 'NGN', onlinePaymentEnabled: true, paymentMode: 'full', depositPercent: 50,
  allowDemoPayments: true, updatedAt: V1,
};

export const STAFF_LIST: StaffList = {
  staff: [
    { id: 'owner-1', email: 'owner@example.com', fullName: 'Olu Owner', phone: null, role: 'owner', isActive: true, createdAt: '2026-10-01T09:00:00Z', updatedAt: V1, therapist: null },
    { id: 'staff-2', email: 'new.person@example.com', fullName: 'New Person', phone: null, role: 'therapist', isActive: false, createdAt: '2026-10-08T09:00:00Z', updatedAt: 'v-staff-2', therapist: null },
    { id: 'staff-3', email: 'tolu@example.com', fullName: 'Tolu Therapist', phone: null, role: 'therapist', isActive: true, createdAt: '2026-10-02T09:00:00Z', updatedAt: 'v-staff-3', therapist: { id: 't-1', name: 'Senior Massage Therapist' } },
  ],
  therapists: [
    { id: 't-1', name: 'Senior Massage Therapist', profileId: 'staff-3', isActive: true, updatedAt: 'v-t1' },
    { id: 't-2', name: 'Lead Spa Therapist', profileId: null, isActive: true, updatedAt: 'v-t2' },
  ],
};

export function auditEntries(count = 3, startId = 100): AuditEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: startId - i, entityType: i % 2 ? 'payments' : 'appointments', entityId: i % 2 ? 'pay-1' : 'appt-1',
    occurredAt: '2026-10-08T09:00:00Z', action: i % 2 ? 'payment.refund_recorded' : 'appointment.cancelled', actorKind: 'staff' as const,
    actorName: 'Olu Owner', actorRole: 'owner', changes: i % 2 ? { refunded_minor: { old: 0, new: 4000000 } } : { contact_phone: { changed: true } },
    reason: 'Guest called', context: {},
  }));
}
export function fakeOps(): { [K in keyof StaffOps]: ReturnType<typeof vi.fn> } & StaffOps {
  return {
    dashboard: vi.fn(async () => DASHBOARD),
    appointments: vi.fn(async () => [appointmentRow()]),
    appointmentDetail: vi.fn(async () => appointmentDetail()),
    agenda: vi.fn(async () => [agendaItem()]),
    bookingOptions: vi.fn(async () => OPTIONS),
    availableSlots: vi.fn(async () => [
      { therapistId: 't-1', startsAt: '2026-10-12T09:00:00Z' },
      { therapistId: 't-2', startsAt: '2026-10-12T10:30:00Z' },
    ]),
    createBooking: vi.fn(async () => ({ id: 'appt-new' })),
    reschedule: vi.fn(async () => {}),
    cancel: vi.fn(async () => ({ refundFlagged: 0, settlement: 'pay_at_venue' as const })),
    setStatus: vi.fn(async () => {}),
    updateBookingDetails: vi.fn(async () => {}),
    setSettlement: vi.fn(async () => {}),
    customers: vi.fn(async () => ({ rows: CUSTOMER_ROWS, total: 2 })),
    customerDetail: vi.fn(async () => customerDetail()),
    createCustomer: vi.fn(async () => ({ id: 'c-new' })),
    updateCustomer: vi.fn(async () => {}),
    scheduleOverview: vi.fn(async () => scheduleOverview()),
    catalogue: vi.fn(async () => catalogue()),
    scheduleConflicts: vi.fn(async () => CONFLICTS),
    setBusinessHours: vi.fn(async () => NO_CONFLICTS),
    setTherapistWeek: vi.fn(async () => NO_CONFLICTS),
    addTimeOff: vi.fn(async () => NO_CONFLICTS),
    removeTimeOff: vi.fn(async () => {}),
    addBlackout: vi.fn(async () => NO_CONFLICTS),
    removeBlackout: vi.fn(async () => {}),
    updateBookingRules: vi.fn(async () => {}),
    saveService: vi.fn(async () => ({ id: 's-new', conflicts: NO_CONFLICTS })),
    setPackageItems: vi.fn(async () => {}),
    saveTherapist: vi.fn(async () => ({ id: 't-new', conflicts: NO_CONFLICTS })),
    setTherapistServices: vi.fn(async () => NO_CONFLICTS),
    saveZone: vi.fn(async () => ({ id: 'z-new', conflicts: NO_CONFLICTS })),
    payments: vi.fn(async () => ({ rows: [paymentRow()], total: 1 })),
    paymentDetail: vi.fn(async () => paymentDetail()),
    recordRefund: vi.fn(async () => {}),
    auditLog: vi.fn(async () => auditEntries()),
    settings: vi.fn(async () => SETTINGS),
    updateBusinessName: vi.fn(async () => {}),
    updatePaymentSettings: vi.fn(async () => {}),
    staffList: vi.fn(async () => STAFF_LIST),
    setStaffRole: vi.fn(async () => {}),
    setStaffActive: vi.fn(async () => {}),
    linkTherapist: vi.fn(async () => {}),
    inviteStaff: vi.fn(async () => ({ profileId: 'staff-new' })),
  } as any;
}
