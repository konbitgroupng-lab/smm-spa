// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useBookingFunnel } from '../../src/booking/useBookingFunnel';
import { ApiError, makeApi, makeCatalog, makeHold, makePayment, slot, SWEDISH } from './fixtures';

// The funnel controller against an in-memory backend: what it asks the server,
// in what order, and how it reacts to the answers.

const CALLBACK = 'http://localhost:3000/?view=payment-return';
const DATE = '2026-10-12';
const details = { fullName: 'Ngozi Example', email: 'ngozi@example.com', phone: '+234 801 234 5678', notes: 'Light pressure' };

function setup(api: ReturnType<typeof makeApi> = makeApi(), options: { preselectServiceId?: string; catalog?: ReturnType<typeof makeCatalog> } = {}) {
  const catalog = options.catalog ?? makeCatalog();
  const hook = renderHook(() => useBookingFunnel({ catalog, callbackUrl: CALLBACK, api, preselectServiceId: options.preselectServiceId }));
  return { ...hook, api, f: () => hook.result.current };
}

/** Service chosen, date chosen, times loaded. */
async function atTimes(api = makeApi(), serviceId = SWEDISH.dbId!) {
  const s = setup(api);
  act(() => s.f().selectService(serviceId));
  act(() => s.f().goTo('datetime'));
  act(() => s.f().selectDate(DATE));
  await waitFor(() => expect(s.f().state.slots).not.toBeNull());
  return s;
}

/** ...and the first time held. */
async function holding(api = makeApi()) {
  const s = await atTimes(api);
  await act(() => s.f().chooseSlot(s.f().slots[0]));
  return s;
}

/** Every argument the funnel sent, flattened, to check nothing price-like leaves the browser. */
const sentKeys = (api: ReturnType<typeof makeApi>) =>
  [api.createHold, api.attachCustomer, api.startPayment, api.getAvailableSlots].flatMap((fn) =>
    fn.mock.calls.flatMap((args: unknown[]) => args.flatMap((a) => (a && typeof a === 'object' ? Object.keys(a) : []))),
  );

describe('availability', () => {
  it('asks the server for times once a treatment and date are chosen', async () => {
    const { api, f } = await atTimes();
    expect(api.getAvailableSlots).toHaveBeenCalledWith(SWEDISH.dbId, DATE, undefined);
    expect(f().slots).toHaveLength(2);
    expect(f().state.pending).toBeNull();
  });

  it('asks again for a specific therapist, and uses the latest answer when answers arrive out of order', async () => {
    let releaseFirst!: () => void;
    const api = makeApi({
      getAvailableSlots: async (_service: string, date: string) => {
        if (date === DATE) await new Promise<void>((resolve) => (releaseFirst = resolve));
        return [slot(`${date}T14:00:00+01:00`)];
      },
    });
    const s = setup(api);
    act(() => s.f().selectService(SWEDISH.dbId!));
    act(() => s.f().selectDate(DATE));
    act(() => s.f().selectDate('2026-10-13'));
    await waitFor(() => expect(s.f().state.slots).not.toBeNull());
    act(() => releaseFirst());
    await new Promise((r) => setTimeout(r, 10));
    expect(s.f().state.slots!.map((x) => x.startsAt)).toEqual([new Date('2026-10-13T14:00:00+01:00').toISOString()]);

    act(() => s.f().selectTherapist('th-bola'));
    act(() => s.f().selectDate('2026-10-14'));
    await waitFor(() => expect(s.f().state.slots).not.toBeNull());
  });

  it('can refresh the times on request', async () => {
    const s = await atTimes();
    const calls = s.api.getAvailableSlots.mock.calls.length;
    act(() => s.f().refreshSlots());
    await waitFor(() => expect(s.api.getAvailableSlots.mock.calls.length).toBe(calls + 1));
  });
});

describe('holding a time', () => {
  it('reserves the chosen time with the guest\'s choices, and nothing about price', async () => {
    const api = makeApi();
    const s = setup(api);
    act(() => s.f().selectService(SWEDISH.dbId!));
    act(() => s.f().setLocation('mobile'));
    act(() => s.f().selectZone('zone-vi'));
    act(() => s.f().setAddress('12 Example Street, Victoria Island'));
    act(() => s.f().selectDate(DATE));
    await waitFor(() => expect(s.f().state.slots).not.toBeNull());
    await act(() => s.f().chooseSlot(s.f().slots[0]));

    expect(api.createHold).toHaveBeenCalledWith({
      serviceId: SWEDISH.dbId, startsAt: s.f().slots[0].startsAt, therapistId: undefined,
      locationType: 'mobile', dispatchZoneId: 'zone-vi', replaceHoldToken: undefined,
    });
    expect(s.f().state.step).toBe('details');
    expect(s.f().state.hold).not.toBeNull();
  });

  it('replaces the previous hold when the guest picks another time', async () => {
    const s = await holding();
    const first = s.f().state.hold!.token;
    act(() => s.f().goTo('datetime'));
    const other = s.f().slots.find((x) => !x.mine)!;
    await act(() => s.f().chooseSlot(other));
    expect(s.api.createHold).toHaveBeenLastCalledWith(expect.objectContaining({ replaceHoldToken: first }));
    expect(s.f().state.hold!.token).not.toBe(first);
    expect(s.api.releaseHold).not.toHaveBeenCalled(); // the server releases it as part of the replacement
  });

  it('choosing the time already held just moves on, without another request', async () => {
    const s = await holding();
    act(() => s.f().goTo('datetime'));
    const mine = s.f().slots.find((x) => x.mine)!;
    expect(mine).toBeDefined();
    const calls = s.api.createHold.mock.calls.length;
    await act(() => s.f().chooseSlot(mine));
    expect(s.api.createHold.mock.calls.length).toBe(calls);
    expect(s.f().state.step).toBe('details');
  });

  it('when the time was just taken, says so and reloads the times', async () => {
    const api = makeApi({ createHold: async () => { throw new ApiError('slot_unavailable'); } });
    const s = await atTimes(api);
    const loads = api.getAvailableSlots.mock.calls.length;
    await act(() => s.f().chooseSlot(s.f().slots[0]));
    expect(s.f().state).toMatchObject({ step: 'datetime', error: 'slot_unavailable', hold: null });
    await waitFor(() => expect(api.getAvailableSlots.mock.calls.length).toBe(loads + 1));
  });

  it('gives the hold back when the guest changes treatment or starts over', async () => {
    const s = await holding();
    const token = s.f().state.hold!.token;
    act(() => s.f().selectService('svc-hot-stone'));
    await waitFor(() => expect(s.api.releaseHold).toHaveBeenCalledWith(token));
    await waitFor(() => expect(s.f().state.releaseQueue).toEqual([]));

    const t = await holding();
    const second = t.f().state.hold!.token;
    act(() => t.f().cancel());
    await waitFor(() => expect(t.api.releaseHold).toHaveBeenCalledWith(second));
    expect(t.f().state.step).toBe('service');
  });

  it('tells the guest when the hold runs out, and returns them to the times', async () => {
    const api = makeApi({ createHold: async (request) => makeHold(request.startsAt, 'th-ada', 150) });
    const s = await atTimes(api);
    await act(() => s.f().chooseSlot(s.f().slots[0]));
    expect(s.f().state.step).toBe('details');
    await waitFor(() => expect(s.f().state.error).toBe('hold_expired'), { timeout: 2000 });
    expect(s.f().state).toMatchObject({ step: 'datetime', hold: null });
  });
});

describe('details and payment', () => {
  it('checks the details before sending anything', async () => {
    const s = await holding();
    act(() => s.f().updateDetails({ fullName: 'N', email: 'not-an-email', phone: '' }));
    await act(() => s.f().submitDetails());
    expect(s.f().state.error).toBe('invalid_details');
    expect(Object.keys(s.f().fieldErrors).sort()).toEqual(['email', 'fullName', 'phone']);
    expect(s.api.attachCustomer).not.toHaveBeenCalled();
    expect(s.api.startPayment).not.toHaveBeenCalled();
  });

  it('saves the details, starts payment with this site as the return address, and shows the server\'s amount', async () => {
    const api = makeApi({ startPayment: async () => makePayment({ amountMinor: 2_000_000, kind: 'deposit', demo: true }) });
    const s = await holding(api);
    act(() => s.f().updateDetails(details));
    await act(() => s.f().submitDetails());

    const token = s.f().state.hold!.token;
    expect(api.attachCustomer).toHaveBeenCalledWith(token, { fullName: details.fullName, email: details.email, phone: details.phone });
    expect(api.startPayment).toHaveBeenCalledWith(token, { serviceAddress: undefined, notes: 'Light pressure', callbackUrl: CALLBACK });
    expect(api.rememberPayment).toHaveBeenCalledWith('SMMP-TEST0001', { holdToken: token, demo: true });
    expect(s.f().state.step).toBe('payment');
    expect(s.f().state.payment).toMatchObject({ amountMinor: 2_000_000, kind: 'deposit', demo: true });
    // Nothing price-like is ever sent from the browser.
    expect(sentKeys(api).filter((k) => /amount|price|total|fee|currency|paid|status/i.test(k))).toEqual([]);
  });

  it('after payment starts, follows the server\'s extended hold time', async () => {
    const api = makeApi({
      createHold: async (request) => makeHold(request.startsAt, 'th-ada', 150),
      startPayment: async () => makePayment({ holdExpiresAt: new Date(Date.now() + 60_000).toISOString() }),
    });
    const s = await atTimes(api);
    await act(() => s.f().chooseSlot(s.f().slots[0]));
    act(() => s.f().updateDetails(details));
    await act(() => s.f().submitDetails());
    await new Promise((r) => setTimeout(r, 300));
    expect(s.f().state.step).toBe('payment'); // the original 150 ms no longer applies
    expect(s.f().expiresAt).toBe(s.f().state.payment!.holdExpiresAt);
  });

  it('does not save the details twice when only starting the payment failed', async () => {
    let attempts = 0;
    const api = makeApi({
      startPayment: async () => {
        if (++attempts === 1) throw new ApiError('gateway_unavailable');
        return makePayment();
      },
    });
    const s = await holding(api);
    act(() => s.f().updateDetails(details));
    await act(() => s.f().submitDetails());
    expect(s.f().state).toMatchObject({ error: 'gateway_unavailable', step: 'details', pending: null });
    await act(() => s.f().submitDetails());
    expect(api.attachCustomer).toHaveBeenCalledTimes(1);
    expect(s.f().state.step).toBe('payment');
  });

  it('a hold that expired on the server sends the guest back to the times', async () => {
    const api = makeApi({ startPayment: async () => { throw new ApiError('hold_expired'); } });
    const s = await holding(api);
    act(() => s.f().updateDetails(details));
    await act(() => s.f().submitDetails());
    expect(s.f().state).toMatchObject({ step: 'datetime', error: 'hold_expired', hold: null });
  });

  it('sends the address for a mobile visit, and the guest cannot skip ahead without paying details', async () => {
    const s = setup(makeApi(), { preselectServiceId: SWEDISH.dbId! });
    expect(s.f().state.serviceId).toBe(SWEDISH.dbId);
    act(() => s.f().setLocation('mobile'));
    act(() => s.f().selectZone('zone-vi'));
    act(() => s.f().setAddress('  12 Example Street  '));
    act(() => s.f().goTo('payment'));
    expect(s.f().state.step).toBe('service');
    act(() => s.f().selectDate(DATE));
    await waitFor(() => expect(s.f().state.slots).not.toBeNull());
    await act(() => s.f().chooseSlot(s.f().slots[0]));
    act(() => s.f().updateDetails(details));
    await act(() => s.f().submitDetails());
    expect(s.api.startPayment).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ serviceAddress: '12 Example Street' }));
    expect(s.f().estimate).toMatchObject({ travelMinor: 800_000, totalMinor: 4_800_000 });
  });
});

describe('derived values', () => {
  it('lists only therapists offering the treatment, and the held therapist', async () => {
    const s = setup();
    act(() => s.f().selectService('svc-hot-stone'));
    expect(s.f().therapists.map((t) => t.name)).toEqual(['Ada']);
    act(() => s.f().selectService(SWEDISH.dbId!));
    expect(s.f().therapists.map((t) => t.name)).toEqual(['Ada', 'Bola']);

    const h = await holding();
    expect(h.f().therapist?.name).toBe('Ada');
    expect(h.f().timeZone).toBe('Africa/Lagos');
  });
});
