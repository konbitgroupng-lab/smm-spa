import { vi } from 'vitest';
import type { BookingCatalog } from '../../src/booking/useBookingCatalog';
import type { FunnelApi } from '../../src/booking/useBookingFunnel';
import type { BookingHold, Slot } from '../../src/services/bookingService';
import type { CatalogPackage, CatalogService, CatalogTherapist } from '../../src/services/catalogService';
import type { PaymentStart } from '../../src/services/paymentService';

// Small hand-made catalogue and an in-memory stand-in for the backend calls,
// for unit-testing the funnel without a database.

const service = (dbId: string, name: string, price: number, duration = 60): CatalogService => ({
  id: name.toLowerCase().replace(/\s+/g, '-'), dbId, name, category: 'Relaxation', duration, bufferMinutes: 15,
  price, formattedPrice: `₦${price.toLocaleString('en-NG')}`, currency: 'NGN', description: '', benefits: [], imageUrl: '',
});

export const SWEDISH = service('svc-swedish', 'Swedish Massage', 40_000);
export const HOT_STONE = service('svc-hot-stone', 'Hot Stone Therapy', 50_000);
export const PACKAGE: CatalogPackage = {
  ...service('pkg-essential', 'Essential Escape', 80_000, 120), includedServiceIds: ['swedish', 'hot-stone'],
  originalPrice: 90_000, formattedOriginalPrice: '₦90,000', popular: false,
};

const therapist = (dbId: string, name: string): CatalogTherapist => ({ id: dbId, dbId, name, role: '', specialty: '', bio: '', avatarUrl: '' });
export const ADA = therapist('th-ada', 'Ada');
export const BOLA = therapist('th-bola', 'Bola');

export function makeCatalog(overrides: Partial<BookingCatalog> = {}): BookingCatalog {
  return {
    services: [SWEDISH, HOT_STONE],
    packages: [PACKAGE],
    therapists: [ADA, BOLA],
    zones: [
      { id: 'zone-vi', key: 'vi', name: 'Victoria Island', feeMinor: 800_000, formattedFee: '₦8,000' },
      { id: 'zone-maryland', key: 'maryland', name: 'Maryland', feeMinor: 0, formattedFee: '₦0' },
    ],
    // Ada offers everything; Bola only Swedish.
    links: new Map([
      ['th-ada', new Set(['svc-swedish', 'svc-hot-stone', 'pkg-essential'])],
      ['th-bola', new Set(['svc-swedish'])],
    ]),
    settings: {
      businessName: 'SMM', timezone: 'Africa/Lagos', currency: 'NGN', onlinePaymentEnabled: true, transferEnabled: false, transferHoldMinutes: 120, paymentMode: 'full',
      depositPercent: 50, holdMinutes: 10, maxAdvanceDays: 60, minLeadMinutes: 120, slotIntervalMinutes: 30,
    },
    ...overrides,
  };
}

export const slot = (startsAt: string, therapistIds = ['th-ada'], minutes = 60): Slot => ({
  startsAt: new Date(startsAt).toISOString(),
  endsAt: new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString(),
  therapistIds,
});

let holdCount = 0;
export function makeHold(startsAt: string, therapistId = 'th-ada', expiresInMs = 10 * 60_000): BookingHold {
  return {
    token: `hold-${++holdCount}`,
    therapistId,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(new Date(startsAt).getTime() + 3_600_000).toISOString(),
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    hasCustomer: false,
  };
}

export function makePayment(overrides: Partial<PaymentStart> = {}): PaymentStart {
  return {
    reference: 'SMMP-TEST0001', checkoutUrl: 'http://localhost:3000/?view=demo-checkout&reference=SMMP-TEST0001',
    amountMinor: 4_000_000, bookingTotalMinor: 4_000_000, currency: 'NGN', kind: 'full',
    holdExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), provider: 'mock', demo: true,
    ...overrides,
  };
}

export class ApiError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/** Backend stand-in: every call is a spy; behaviour can be overridden per test. */
export function makeApi(overrides: Partial<FunnelApi> = {}) {
  const api = {
    getAvailableSlots: vi.fn(async () => [slot('2026-10-12T09:00:00+01:00'), slot('2026-10-12T10:00:00+01:00', ['th-ada', 'th-bola'])]),
    createHold: vi.fn(async (request) => makeHold(request.startsAt, request.therapistId ?? 'th-ada')),
    attachCustomer: vi.fn(async (token: string) => ({ ...makeHold('2026-10-12T09:00:00+01:00'), token, hasCustomer: true })),
    releaseHold: vi.fn(async () => true),
    startPayment: vi.fn(async () => makePayment()),
    rememberPayment: vi.fn(),
  };
  // Overrides are spies too, so every call can be inspected.
  for (const [name, impl] of Object.entries(overrides)) (api as Record<string, unknown>)[name] = vi.fn(impl as (...args: any[]) => any);
  return api as typeof api & FunnelApi;
}
