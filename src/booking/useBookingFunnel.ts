import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { rememberPendingPayment } from './pendingPayment';
import { attachCustomer, createHold, getAvailableSlots, releaseHold } from '../services/bookingService';
import { startPayment } from '../services/paymentService';
import { DEFAULT_TIMEZONE } from './dates';
import {
  canEnter,
  displaySlots,
  estimatePrice,
  funnelReducer,
  furthestStep,
  initialFunnelState,
  slotsKeyOf,
  STEPS,
  therapistsFor,
  validateDetails,
  type DisplaySlot,
  type FunnelStep,
  type GuestDetails,
  type LocationType,
} from './funnel';
import type { BookingCatalog } from './useBookingCatalog';

// Connects the funnel state machine to the backend: availability -> hold ->
// customer details -> payment. Every decision is the server's; this hook only
// asks, records the answers, and keeps the guest's choices consistent.

/** The backend calls the funnel makes. Injected in tests; the real services by default. */
export interface FunnelApi {
  getAvailableSlots: typeof getAvailableSlots;
  createHold: typeof createHold;
  attachCustomer: typeof attachCustomer;
  releaseHold: typeof releaseHold;
  startPayment: typeof startPayment;
  /** Lets the confirmation page offer a retry after a failed payment (this tab only). */
  rememberPayment: typeof rememberPendingPayment;
}

export const defaultFunnelApi: FunnelApi = {
  getAvailableSlots,
  createHold,
  attachCustomer,
  releaseHold,
  startPayment,
  rememberPayment: rememberPendingPayment,
};

export interface UseBookingFunnelOptions {
  catalog: BookingCatalog;
  /** Same-site address the checkout returns the guest to. */
  callbackUrl: string;
  api?: FunnelApi;
  preselectServiceId?: string | null;
}

const errorCode = (err: unknown): string => (err as { code?: string } | null)?.code ?? 'unknown';

export function useBookingFunnel({ catalog, callbackUrl, api = defaultFunnelApi, preselectServiceId = null }: UseBookingFunnelOptions) {
  const [state, dispatch] = useReducer(funnelReducer, preselectServiceId, (serviceId) => initialFunnelState({ serviceId }));
  const timeZone = catalog.settings.timezone || DEFAULT_TIMEZONE;

  // Latest state for async callbacks, without re-creating them on every change.
  const stateRef = useRef(state);
  stateRef.current = state;

  // ---- Availability: load whenever the query changes and no answer is held ----
  const key = slotsKeyOf(state);
  const loadingKey = useRef<string | null>(null);
  useEffect(() => {
    if (!key || state.slots !== null || loadingKey.current === key) return;
    const { serviceId, date, therapistId } = state;
    loadingKey.current = key;
    dispatch({ type: 'slotsRequested', key });
    api
      .getAvailableSlots(serviceId!, date!, therapistId ?? undefined)
      .then((slots) => dispatch({ type: 'slotsLoaded', key, slots }))
      .catch((err) => dispatch({ type: 'slotsFailed', key, error: errorCode(err) }))
      .finally(() => {
        if (loadingKey.current === key) loadingKey.current = null;
      });
  }, [key, state.slots]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Give back holds the guest no longer wants ----
  const releasing = useRef(new Set<string>());
  useEffect(() => {
    for (const token of state.releaseQueue) {
      if (releasing.current.has(token)) continue;
      releasing.current.add(token);
      api
        .releaseHold(token)
        .catch(() => undefined) // it expires on its own anyway
        .finally(() => {
          releasing.current.delete(token);
          dispatch({ type: 'released', token });
        });
    }
  }, [state.releaseQueue, api]);

  // ---- The hold's lifetime is the server's; mirror it so the guest is told in time ----
  const expiresAt = state.payment?.holdExpiresAt ?? state.hold?.expiresAt ?? null;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => dispatch({ type: 'holdExpired' }), Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);

  // ---- Guest actions ----
  const selectService = useCallback((serviceId: string) => dispatch({ type: 'selectService', serviceId }), []);
  const setLocation = useCallback((location: LocationType) => dispatch({ type: 'setLocation', location }), []);
  const selectZone = useCallback((zoneId: string | null) => dispatch({ type: 'selectZone', zoneId }), []);
  const setAddress = useCallback((address: string) => dispatch({ type: 'setAddress', address }), []);
  const selectTherapist = useCallback((therapistId: string | null) => dispatch({ type: 'selectTherapist', therapistId }), []);
  const selectDate = useCallback((date: string) => dispatch({ type: 'selectDate', date }), []);
  const updateDetails = useCallback((patch: Partial<GuestDetails>) => dispatch({ type: 'detailsChanged', patch }), []);
  const goTo = useCallback((step: FunnelStep) => dispatch({ type: 'goTo', step }), []);
  const dismissError = useCallback(() => dispatch({ type: 'dismissError' }), []);
  const cancel = useCallback(() => dispatch({ type: 'reset' }), []);

  const back = useCallback(() => {
    const index = STEPS.indexOf(stateRef.current.step);
    if (index > 0) dispatch({ type: 'goTo', step: STEPS[index - 1] });
  }, []);

  const refreshSlots = useCallback(() => {
    loadingKey.current = null;
    dispatch({ type: 'refreshSlots' }); // cleared times are reloaded by the effect above
  }, []);

  /** Reserve a time. Choosing the guest's own reserved time just moves on. */
  const chooseSlot = useCallback(
    async (slot: DisplaySlot) => {
      const current = stateRef.current;
      if (slot.mine && current.hold) {
        dispatch({ type: 'goTo', step: 'details' });
        return;
      }
      if (!current.serviceId || current.pending === 'hold') return;
      dispatch({ type: 'holdRequested' });
      try {
        const hold = await api.createHold({
          serviceId: current.serviceId,
          startsAt: slot.startsAt,
          therapistId: current.therapistId ?? undefined,
          locationType: current.location,
          dispatchZoneId: current.location === 'mobile' ? current.dispatchZoneId ?? undefined : undefined,
          replaceHoldToken: current.hold?.token, // one hold per guest: the previous one is released
        });
        dispatch({ type: 'holdCreated', hold });
      } catch (err) {
        dispatch({ type: 'holdFailed', error: errorCode(err) });
      }
    },
    [api],
  );

  /**
   * Save the guest's details against the hold, then start payment. The server
   * sets the amount; nothing about price is sent from here.
   */
  const submitDetails = useCallback(async () => {
    const current = stateRef.current;
    if (!current.hold || current.pending === 'details' || current.pending === 'payment') return;
    if (Object.keys(validateDetails(current.details)).length > 0) {
      dispatch({ type: 'requestFailed', error: 'invalid_details' });
      return;
    }
    const hold = current.hold;
    dispatch({ type: 'detailsRequested' });
    try {
      if (current.detailsSavedFor !== hold.token) {
        await api.attachCustomer(hold.token, {
          fullName: current.details.fullName.trim(),
          email: current.details.email.trim(),
          phone: current.details.phone.trim(),
        });
      }
      dispatch({ type: 'detailsSaved', holdToken: hold.token });
      const payment = await api.startPayment(hold.token, {
        serviceAddress: current.location === 'mobile' ? current.serviceAddress.trim() : undefined,
        notes: current.details.notes.trim() || undefined,
        callbackUrl,
      });
      api.rememberPayment(payment.reference, { holdToken: hold.token, demo: payment.demo });
      dispatch({ type: 'paymentStarted', payment });
    } catch (err) {
      const code = errorCode(err);
      if (code === 'hold_expired') dispatch({ type: 'holdExpired' });
      else dispatch({ type: 'requestFailed', error: code });
    }
  }, [api, callbackUrl]);

  // ---- Derived values for the screens ----
  const allItems = useMemo(() => [...catalog.services, ...catalog.packages], [catalog]);
  const item = allItems.find((i) => i.dbId === state.serviceId);
  const zone = catalog.zones.find((z) => z.id === state.dispatchZoneId);
  const therapists = useMemo(() => therapistsFor(state.serviceId, catalog.therapists, catalog.links), [state.serviceId, catalog]);
  const therapist = catalog.therapists.find((t) => t.dbId === (state.hold?.therapistId ?? state.therapistId));
  const slots = useMemo(() => displaySlots(state, timeZone), [state.slots, state.hold, state.therapistId, state.date, timeZone]); // eslint-disable-line react-hooks/exhaustive-deps
  const estimate = useMemo(() => estimatePrice(item, zone, state.location, catalog.settings), [item, zone, state.location, catalog.settings]);
  const fieldErrors = useMemo(() => (state.error === 'invalid_details' ? validateDetails(state.details) : {}), [state.error, state.details]);

  return {
    state,
    timeZone,
    /** The furthest step reachable now, and whether a given step is. */
    furthestStep: furthestStep(state),
    canEnter: (step: FunnelStep) => canEnter(state, step),
    item,
    zone,
    therapist,
    therapists,
    slots,
    estimate,
    fieldErrors,
    expiresAt,
    selectService,
    setLocation,
    selectZone,
    setAddress,
    selectTherapist,
    selectDate,
    refreshSlots,
    chooseSlot,
    updateDetails,
    submitDetails,
    goTo,
    back,
    cancel,
    dismissError,
  };
}

export type BookingFunnel = ReturnType<typeof useBookingFunnel>;
