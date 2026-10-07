// The booking funnel as a pure state machine: no network, no React.
//
//   service -> therapist -> datetime -> details -> payment
//
// The server stays authoritative throughout. This state only records what the
// guest has chosen and what the server has answered (free times, the hold, the
// payment it started). Prices shown before payment are estimates from the
// catalogue; the amount charged is always the one the server returns.

import type { BookingHold, Slot } from '../services/bookingService';
import type { CatalogPackage, CatalogService, CatalogTherapist, DispatchZone } from '../services/catalogService';
import type { BusinessSettings } from '../services/contentService';
import type { PaymentStart } from '../services/paymentService';
import { localDateOf } from './dates';

export type FunnelStep = 'service' | 'therapist' | 'datetime' | 'details' | 'payment';
export const STEPS: readonly FunnelStep[] = ['service', 'therapist', 'datetime', 'details', 'payment'];

export type LocationType = 'sanctuary' | 'mobile';

export interface GuestDetails {
  fullName: string;
  email: string;
  phone: string;
  notes: string;
}

/** What a request is waiting for, if anything. */
export type Pending = 'slots' | 'hold' | 'details' | 'payment' | null;

/**
 * Error codes shown to the guest. Server codes are passed through; the
 * funnel adds `invalid_details` (checked before anything is sent) and
 * `unknown`.
 */
export type FunnelError = string;

export interface FunnelState {
  step: FunnelStep;
  serviceId: string | null;
  location: LocationType;
  dispatchZoneId: string | null;
  serviceAddress: string;
  /** null = any available therapist. */
  therapistId: string | null;
  date: string | null;
  /** Free times for `slotsKey`; null when they need (re)loading. */
  slots: Slot[] | null;
  slotsKey: string | null;
  hold: BookingHold | null;
  /** Holds the guest no longer wants, waiting to be released on the server. */
  releaseQueue: string[];
  details: GuestDetails;
  /** The hold token the details were last saved against. */
  detailsSavedFor: string | null;
  payment: PaymentStart | null;
  pending: Pending;
  error: FunnelError | null;
}

export type FunnelAction =
  | { type: 'selectService'; serviceId: string }
  | { type: 'setLocation'; location: LocationType }
  | { type: 'selectZone'; zoneId: string | null }
  | { type: 'setAddress'; address: string }
  | { type: 'selectTherapist'; therapistId: string | null }
  | { type: 'selectDate'; date: string }
  | { type: 'refreshSlots' }
  | { type: 'slotsRequested'; key: string }
  | { type: 'slotsLoaded'; key: string; slots: Slot[] }
  | { type: 'slotsFailed'; key: string; error: FunnelError }
  | { type: 'holdRequested' }
  | { type: 'holdCreated'; hold: BookingHold }
  | { type: 'holdFailed'; error: FunnelError }
  | { type: 'holdExpired' }
  | { type: 'detailsChanged'; patch: Partial<GuestDetails> }
  | { type: 'detailsRequested' }
  | { type: 'detailsSaved'; holdToken: string }
  | { type: 'paymentStarted'; payment: PaymentStart }
  | { type: 'requestFailed'; error: FunnelError }
  | { type: 'goTo'; step: FunnelStep }
  | { type: 'released'; token: string }
  | { type: 'dismissError' }
  | { type: 'reset' };

const EMPTY_DETAILS: GuestDetails = { fullName: '', email: '', phone: '', notes: '' };

export function initialFunnelState(preselect: { serviceId?: string | null } = {}): FunnelState {
  return {
    step: 'service',
    serviceId: preselect.serviceId ?? null,
    location: 'sanctuary',
    dispatchZoneId: null,
    serviceAddress: '',
    therapistId: null,
    date: null,
    slots: null,
    slotsKey: null,
    hold: null,
    releaseQueue: [],
    details: EMPTY_DETAILS,
    detailsSavedFor: null,
    payment: null,
    pending: null,
    error: null,
  };
}

/** Identifies one availability query; slots are only valid for the key they were loaded for. */
export function slotsKeyOf(state: Pick<FunnelState, 'serviceId' | 'therapistId' | 'date'>): string | null {
  if (!state.serviceId || !state.date) return null;
  return `${state.serviceId}|${state.therapistId ?? 'any'}|${state.date}`;
}

export const MIN_ADDRESS_LENGTH = 5;

/** Service step complete: a treatment, and for mobile visits a zone and an address. */
export function serviceReady(state: FunnelState): boolean {
  if (!state.serviceId) return false;
  if (state.location === 'sanctuary') return true;
  return Boolean(state.dispatchZoneId) && state.serviceAddress.trim().length >= MIN_ADDRESS_LENGTH;
}

/** Whether the guest may be on `step` given what has been chosen so far. */
export function canEnter(state: FunnelState, step: FunnelStep): boolean {
  switch (step) {
    case 'service':
      return true;
    case 'therapist':
    case 'datetime':
      return serviceReady(state);
    case 'details':
      return serviceReady(state) && state.hold !== null;
    case 'payment':
      return serviceReady(state) && state.hold !== null && state.payment !== null && state.detailsSavedFor === state.hold.token;
  }
}

/** The furthest step the guest could move to right now. */
export function furthestStep(state: FunnelState): FunnelStep {
  return [...STEPS].reverse().find((step) => canEnter(state, step)) ?? 'service';
}

/**
 * The guest changed something the hold depends on (treatment, place, therapist):
 * the hold and anything built on it no longer apply.
 */
function invalidateHold(state: FunnelState): FunnelState {
  return {
    ...state,
    slots: null,
    slotsKey: null,
    hold: null,
    releaseQueue: state.hold ? [...state.releaseQueue, state.hold.token] : state.releaseQueue,
    detailsSavedFor: null,
    payment: null,
    pending: null,
    error: null,
  };
}

export function funnelReducer(state: FunnelState, action: FunnelAction): FunnelState {
  switch (action.type) {
    case 'selectService':
      if (action.serviceId === state.serviceId) return state;
      // A therapist chosen for another treatment may not offer this one.
      return { ...invalidateHold(state), serviceId: action.serviceId, therapistId: null, step: 'service' };

    case 'setLocation':
      if (action.location === state.location) return state;
      return {
        ...invalidateHold(state),
        location: action.location,
        dispatchZoneId: action.location === 'mobile' ? state.dispatchZoneId : null,
        serviceAddress: action.location === 'mobile' ? state.serviceAddress : '',
        step: 'service',
      };

    case 'selectZone':
      if (action.zoneId === state.dispatchZoneId) return state;
      return { ...invalidateHold(state), dispatchZoneId: action.zoneId, step: 'service' };

    case 'setAddress': {
      // The address is part of what the hold and payment were made for.
      const base = state.hold ? invalidateHold(state) : state;
      return { ...base, serviceAddress: action.address };
    }

    case 'selectTherapist':
      if (action.therapistId === state.therapistId) return state;
      return { ...invalidateHold(state), therapistId: action.therapistId, step: 'therapist' };

    case 'selectDate':
      // Browsing another date keeps the current hold until a new time is chosen.
      if (action.date === state.date) return state;
      return { ...state, date: action.date, slots: null, slotsKey: null, error: null };

    case 'refreshSlots':
      return { ...state, slots: null, slotsKey: null, error: null };

    case 'slotsRequested':
      // Keeps any message (e.g. "that time was just taken"): reloading the times
      // follows such errors automatically and must not hide them.
      return { ...state, pending: 'slots' };

    case 'slotsLoaded':
      // Answers for a query the guest has since moved away from are ignored.
      if (action.key !== slotsKeyOf(state)) return state;
      return { ...state, slots: action.slots, slotsKey: action.key, pending: null };

    case 'slotsFailed':
      if (action.key !== slotsKeyOf(state)) return state;
      return { ...state, pending: null, error: action.error };

    case 'holdRequested':
      return { ...state, pending: 'hold', error: null };

    case 'holdCreated':
      // A new hold replaces the previous one on the server (replaceHoldToken),
      // so there is nothing to release. Details must be saved against it again.
      return {
        ...state,
        hold: action.hold,
        detailsSavedFor: null,
        payment: null,
        pending: null,
        error: null,
        step: 'details',
      };

    case 'holdFailed':
      // Typically slot_unavailable: someone else took the time. Refresh the times.
      return { ...state, pending: null, error: action.error, slots: null, slotsKey: null, step: 'datetime' };

    case 'holdExpired':
      return {
        ...state,
        hold: null,
        payment: null,
        detailsSavedFor: null,
        slots: null,
        slotsKey: null,
        pending: null,
        error: 'hold_expired',
        step: 'datetime',
      };

    case 'detailsChanged': {
      const details = { ...state.details, ...action.patch };
      // Edited details must be saved again before paying.
      return { ...state, details, detailsSavedFor: null, payment: null };
    }

    case 'detailsRequested':
      return { ...state, pending: 'details', error: null };

    case 'detailsSaved':
      return { ...state, detailsSavedFor: action.holdToken, pending: 'payment' };

    case 'paymentStarted':
      if (!state.hold) return state;
      return { ...state, payment: action.payment, pending: null, error: null, step: 'payment' };

    case 'requestFailed':
      return { ...state, pending: null, error: action.error };

    case 'goTo': {
      if (!canEnter(state, action.step)) return state;
      return { ...state, step: action.step, error: null };
    }

    case 'released':
      return { ...state, releaseQueue: state.releaseQueue.filter((token) => token !== action.token) };

    case 'dismissError':
      return { ...state, error: null };

    case 'reset':
      return {
        ...initialFunnelState(),
        releaseQueue: state.hold ? [...state.releaseQueue, state.hold.token] : state.releaseQueue,
      };
  }
}

// ---------------------------------------------------------------------------
// Derived views
// ---------------------------------------------------------------------------

export interface DisplaySlot extends Slot {
  /** The time this guest is currently holding. */
  mine: boolean;
}

/**
 * The times to offer. The guest's own hold is not in the server's list (it is
 * taken - by them), so it is added back and marked, letting them see and keep
 * their reserved time while browsing.
 */
export function displaySlots(state: Pick<FunnelState, 'slots' | 'hold' | 'therapistId' | 'date'>, timeZone: string): DisplaySlot[] {
  if (!state.slots) return [];
  const slots: DisplaySlot[] = state.slots.map((slot) => ({ ...slot, mine: false }));
  const hold = state.hold;
  if (
    hold &&
    state.date &&
    localDateOf(hold.startsAt, timeZone) === state.date &&
    (state.therapistId === null || state.therapistId === hold.therapistId)
  ) {
    const existing = slots.find((slot) => slot.startsAt === new Date(hold.startsAt).toISOString());
    if (existing) existing.mine = true;
    else slots.push({ startsAt: new Date(hold.startsAt).toISOString(), endsAt: new Date(hold.endsAt).toISOString(), therapistIds: [hold.therapistId], mine: true });
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export type BookableItem = CatalogService | CatalogPackage;

/** Therapists who offer the chosen treatment. */
export function therapistsFor(serviceId: string | null, therapists: CatalogTherapist[], links: Map<string, Set<string>>): CatalogTherapist[] {
  if (!serviceId) return [];
  return therapists.filter((t) => t.dbId && links.get(t.dbId)?.has(serviceId));
}

export interface PriceEstimate {
  /** Treatment price, in minor units. */
  serviceMinor: number;
  /** Travel fee for mobile visits, in minor units. */
  travelMinor: number;
  totalMinor: number;
  /** Deposit or full amount expected at checkout. The server's figure is final. */
  dueNowMinor: number;
  kind: 'deposit' | 'full';
}

/**
 * What the guest can expect to pay, for display before payment starts. It
 * mirrors the server's calculation, but the amount actually charged is always
 * the one the server returns when payment starts.
 */
export function estimatePrice(
  item: BookableItem | undefined,
  zone: DispatchZone | undefined,
  location: LocationType,
  settings: Pick<BusinessSettings, 'paymentMode' | 'depositPercent'> | null,
): PriceEstimate | null {
  if (!item) return null;
  const serviceMinor = Math.round(item.price * 100);
  const travelMinor = location === 'mobile' && zone ? zone.feeMinor : 0;
  const totalMinor = serviceMinor + travelMinor;
  const deposit = settings?.paymentMode === 'deposit';
  return {
    serviceMinor,
    travelMinor,
    totalMinor,
    dueNowMinor: deposit ? Math.ceil((totalMinor * settings!.depositPercent) / 100) : totalMinor,
    kind: deposit ? 'deposit' : 'full',
  };
}

// ---------------------------------------------------------------------------
// Guest details (checked here for quick feedback; the server checks again)
// ---------------------------------------------------------------------------

export type DetailsField = 'fullName' | 'email' | 'phone' | 'notes';

export function validateDetails(details: GuestDetails): Partial<Record<DetailsField, string>> {
  const errors: Partial<Record<DetailsField, string>> = {};
  const name = details.fullName.trim();
  if (name.length < 2 || name.length > 120) errors.fullName = 'Please enter your full name.';
  const email = details.email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) errors.email = 'Please enter a valid email address.';
  if (!/^\+?[0-9][0-9 ()-]{6,19}$/.test(details.phone.trim())) errors.phone = 'Please enter a valid phone number, e.g. +234 801 234 5678.';
  if (details.notes.length > 1000) errors.notes = 'Please keep notes under 1,000 characters.';
  return errors;
}
