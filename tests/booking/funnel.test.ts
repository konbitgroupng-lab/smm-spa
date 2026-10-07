import { describe, expect, it } from 'vitest';
import {
  canEnter,
  displaySlots,
  estimatePrice,
  funnelReducer,
  furthestStep,
  initialFunnelState,
  slotsKeyOf,
  therapistsFor,
  validateDetails,
  type FunnelAction,
  type FunnelState,
} from '../../src/booking/funnel';
import { ADA, BOLA, HOT_STONE, makeCatalog, makeHold, makePayment, PACKAGE, slot, SWEDISH } from './fixtures';

const run = (actions: FunnelAction[], start: FunnelState = initialFunnelState()) => actions.reduce(funnelReducer, start);
const DATE = '2026-10-12';
const NINE = '2026-10-12T09:00:00+01:00';
const goodDetails = { fullName: 'Ngozi Example', email: 'ngozi@example.com', phone: '+234 801 234 5678', notes: '' };

/** A guest who has chosen Swedish, any therapist, a date, and holds 09:00. */
function holding(): FunnelState {
  return run([
    { type: 'selectService', serviceId: SWEDISH.dbId! },
    { type: 'selectDate', date: DATE },
    { type: 'slotsLoaded', key: `${SWEDISH.dbId}|any|${DATE}`, slots: [slot(NINE)] },
    { type: 'holdCreated', hold: makeHold(NINE) },
  ]);
}

describe('step guards', () => {
  it('starts on the service step with nothing chosen, optionally preselected', () => {
    expect(initialFunnelState()).toMatchObject({ step: 'service', serviceId: null, location: 'sanctuary', hold: null, payment: null });
    expect(initialFunnelState({ serviceId: 'svc-swedish' }).serviceId).toBe('svc-swedish');
  });

  it('needs a treatment before therapist and time, and a zone plus address for mobile visits', () => {
    let state = initialFunnelState();
    expect(canEnter(state, 'therapist')).toBe(false);
    state = funnelReducer(state, { type: 'selectService', serviceId: SWEDISH.dbId! });
    expect(canEnter(state, 'therapist')).toBe(true);
    expect(canEnter(state, 'datetime')).toBe(true);

    state = funnelReducer(state, { type: 'setLocation', location: 'mobile' });
    expect(canEnter(state, 'therapist')).toBe(false);
    state = funnelReducer(state, { type: 'selectZone', zoneId: 'zone-vi' });
    expect(canEnter(state, 'therapist')).toBe(false);
    state = funnelReducer(state, { type: 'setAddress', address: '12 ' });
    expect(canEnter(state, 'therapist')).toBe(false); // too short
    state = funnelReducer(state, { type: 'setAddress', address: '12 Example Street, VI' });
    expect(canEnter(state, 'therapist')).toBe(true);
  });

  it('needs a hold for details, and saved details plus a started payment for the payment step', () => {
    let state = holding();
    expect(state.step).toBe('details');
    expect(canEnter(state, 'details')).toBe(true);
    expect(canEnter(state, 'payment')).toBe(false);
    state = funnelReducer(state, { type: 'detailsSaved', holdToken: state.hold!.token });
    expect(canEnter(state, 'payment')).toBe(false); // no payment yet
    state = funnelReducer(state, { type: 'paymentStarted', payment: makePayment() });
    expect(state.step).toBe('payment');
    expect(canEnter(state, 'payment')).toBe(true);
    expect(furthestStep(state)).toBe('payment');
  });

  it('refuses to jump ahead, but always allows going back', () => {
    const state = run([{ type: 'selectService', serviceId: SWEDISH.dbId! }]);
    expect(funnelReducer(state, { type: 'goTo', step: 'details' })).toBe(state);
    expect(funnelReducer(state, { type: 'goTo', step: 'payment' })).toBe(state);
    const paid = run([{ type: 'detailsSaved', holdToken: holding().hold!.token }], holding());
    const atPayment = funnelReducer(paid, { type: 'paymentStarted', payment: makePayment() });
    expect(funnelReducer(atPayment, { type: 'goTo', step: 'service' }).step).toBe('service');
  });
});

describe('the hold follows the guest\'s choices', () => {
  it('changing treatment, place, zone or therapist gives the hold back and clears what depended on it', () => {
    for (const change of [
      { type: 'selectService', serviceId: HOT_STONE.dbId! },
      { type: 'setLocation', location: 'mobile' },
      { type: 'selectTherapist', therapistId: BOLA.dbId },
    ] as FunnelAction[]) {
      const before = run([{ type: 'detailsSaved', holdToken: holding().hold!.token }], holding());
      const after = funnelReducer(before, change);
      expect(after.hold).toBeNull();
      expect(after.payment).toBeNull();
      expect(after.detailsSavedFor).toBeNull();
      expect(after.slots).toBeNull();
      expect(after.releaseQueue).toEqual([before.hold!.token]);
    }
  });

  it('choosing another treatment also clears a therapist who may not offer it', () => {
    const state = run([
      { type: 'selectService', serviceId: SWEDISH.dbId! },
      { type: 'selectTherapist', therapistId: BOLA.dbId },
      { type: 'selectService', serviceId: HOT_STONE.dbId! },
    ]);
    expect(state.therapistId).toBeNull();
  });

  it('browsing another date keeps the hold; picking a new time replaces it', () => {
    const before = holding();
    const browsing = funnelReducer(before, { type: 'selectDate', date: '2026-10-13' });
    expect(browsing.hold).toEqual(before.hold);
    expect(browsing.slots).toBeNull();
    expect(browsing.releaseQueue).toEqual([]);

    const replaced = funnelReducer(browsing, { type: 'holdCreated', hold: makeHold('2026-10-13T11:00:00+01:00') });
    expect(replaced.hold!.token).not.toBe(before.hold!.token);
    expect(replaced.releaseQueue).toEqual([]); // replaced on the server via replaceHoldToken
    expect(replaced.step).toBe('details');
  });

  it('a taken time sends the guest back to the times, which are reloaded', () => {
    const state = run([
      { type: 'selectService', serviceId: SWEDISH.dbId! },
      { type: 'selectDate', date: DATE },
      { type: 'slotsLoaded', key: `${SWEDISH.dbId}|any|${DATE}`, slots: [slot(NINE)] },
      { type: 'holdRequested' },
      { type: 'holdFailed', error: 'slot_unavailable' },
    ]);
    expect(state).toMatchObject({ step: 'datetime', error: 'slot_unavailable', slots: null, pending: null });
  });

  it('when the hold expires the guest returns to the times, keeping the details they typed', () => {
    let state = holding();
    state = funnelReducer(state, { type: 'detailsChanged', patch: goodDetails });
    state = funnelReducer(state, { type: 'detailsSaved', holdToken: state.hold!.token });
    state = funnelReducer(state, { type: 'paymentStarted', payment: makePayment() });
    state = funnelReducer(state, { type: 'holdExpired' });
    expect(state).toMatchObject({ step: 'datetime', error: 'hold_expired', hold: null, payment: null, detailsSavedFor: null, slots: null });
    expect(state.details).toEqual(goodDetails);
  });

  it('starting over gives the hold back', () => {
    const before = holding();
    const after = funnelReducer(before, { type: 'reset' });
    expect(after).toMatchObject({ step: 'service', serviceId: null, hold: null });
    expect(after.releaseQueue).toEqual([before.hold!.token]);
    expect(funnelReducer(after, { type: 'released', token: before.hold!.token }).releaseQueue).toEqual([]);
  });
});

describe('details and payment', () => {
  it('editing details after they were saved requires saving them again and a fresh payment start', () => {
    let state = holding();
    state = funnelReducer(state, { type: 'detailsSaved', holdToken: state.hold!.token });
    state = funnelReducer(state, { type: 'paymentStarted', payment: makePayment() });
    state = funnelReducer(state, { type: 'detailsChanged', patch: { phone: '+2348099999999' } });
    expect(state.detailsSavedFor).toBeNull();
    expect(state.payment).toBeNull();
    expect(canEnter(state, 'payment')).toBe(false);
  });

  it('a payment start without a hold is ignored', () => {
    const state = run([{ type: 'selectService', serviceId: SWEDISH.dbId! }]);
    expect(funnelReducer(state, { type: 'paymentStarted', payment: makePayment() })).toBe(state);
  });

  it('validates details the same way the server does', () => {
    expect(validateDetails(goodDetails)).toEqual({});
    expect(Object.keys(validateDetails({ fullName: 'A', email: 'nope', phone: 'call me', notes: 'x'.repeat(1001) })).sort()).toEqual(['email', 'fullName', 'notes', 'phone']);
    expect(validateDetails({ ...goodDetails, phone: '08012345678' })).toEqual({});
  });
});

describe('availability answers', () => {
  it('reloading the times keeps the message that caused the reload', () => {
    const state = run([
      { type: 'selectService', serviceId: SWEDISH.dbId! },
      { type: 'selectDate', date: DATE },
      { type: 'holdFailed', error: 'slot_unavailable' },
      { type: 'slotsRequested', key: `${SWEDISH.dbId}|any|${DATE}` },
      { type: 'slotsLoaded', key: `${SWEDISH.dbId}|any|${DATE}`, slots: [slot(NINE)] },
    ]);
    expect(state.error).toBe('slot_unavailable');
    expect(funnelReducer(state, { type: 'holdRequested' }).error).toBeNull(); // cleared once the guest acts
  });

  it('ignores answers for a query the guest has moved away from', () => {
    let state = run([{ type: 'selectService', serviceId: SWEDISH.dbId! }, { type: 'selectDate', date: DATE }]);
    const oldKey = slotsKeyOf(state)!;
    state = funnelReducer(state, { type: 'selectDate', date: '2026-10-13' });
    state = funnelReducer(state, { type: 'slotsLoaded', key: oldKey, slots: [slot(NINE)] });
    expect(state.slots).toBeNull();
    state = funnelReducer(state, { type: 'slotsFailed', key: oldKey, error: 'server_error' });
    expect(state.error).toBeNull();
  });

  it('adds the guest\'s own reserved time back into the list, marked as theirs', () => {
    const state = holding();
    const withoutMine = { ...state, slots: [slot('2026-10-12T10:00:00+01:00')] }; // the server no longer offers 09:00: it is held
    const shown = displaySlots(withoutMine, 'Africa/Lagos');
    expect(shown.map((s) => [new Date(s.startsAt).toISOString(), s.mine])).toEqual([
      [new Date(NINE).toISOString(), true],
      [new Date('2026-10-12T10:00:00+01:00').toISOString(), false],
    ]);
    // Not on another date, nor when browsing a therapist other than the held one.
    expect(displaySlots({ ...withoutMine, date: '2026-10-13' }, 'Africa/Lagos').some((s) => s.mine)).toBe(false);
    expect(displaySlots({ ...withoutMine, therapistId: 'th-bola' }, 'Africa/Lagos').some((s) => s.mine)).toBe(false);
  });
});

describe('catalogue helpers', () => {
  it('lists only the therapists who offer the chosen treatment', () => {
    const { therapists, links } = makeCatalog();
    expect(therapistsFor(SWEDISH.dbId!, therapists, links).map((t) => t.name)).toEqual([ADA.name, BOLA.name]);
    expect(therapistsFor(HOT_STONE.dbId!, therapists, links).map((t) => t.name)).toEqual([ADA.name]);
    expect(therapistsFor(null, therapists, links)).toEqual([]);
  });

  it('estimates the price the way the server will charge it (display only)', () => {
    const { zones } = makeCatalog();
    expect(estimatePrice(SWEDISH, undefined, 'sanctuary', { paymentMode: 'full', depositPercent: 50 })).toEqual({
      serviceMinor: 4_000_000, travelMinor: 0, totalMinor: 4_000_000, dueNowMinor: 4_000_000, kind: 'full',
    });
    expect(estimatePrice(SWEDISH, zones[0], 'mobile', { paymentMode: 'deposit', depositPercent: 33 })).toEqual({
      serviceMinor: 4_000_000, travelMinor: 800_000, totalMinor: 4_800_000, dueNowMinor: 1_584_000, kind: 'deposit',
    });
    expect(estimatePrice(SWEDISH, zones[0], 'sanctuary', null)?.travelMinor).toBe(0); // no fee at the sanctuary
    expect(estimatePrice(PACKAGE, undefined, 'sanctuary', null)?.totalMinor).toBe(8_000_000);
    expect(estimatePrice(undefined, undefined, 'sanctuary', null)).toBeNull();
  });
});
