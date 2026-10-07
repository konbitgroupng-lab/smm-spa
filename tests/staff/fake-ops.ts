import { vi } from 'vitest';
import type {
  AgendaItem, AppointmentDetail, AppointmentRow, BookingOptions, CustomerDetail, CustomerRow, Dashboard, StaffOps,
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
  awaitingOutcome: 1, refundsFlagged: 2, next7Days: 12,
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
  } as any;
}
