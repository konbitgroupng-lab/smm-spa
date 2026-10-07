// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { loadBookingCatalog, useBookingCatalog, type CatalogApi } from '../../src/booking/useBookingCatalog';
import { ADA, makeCatalog, PACKAGE, SWEDISH } from './fixtures';

const fixture = makeCatalog();
function api(overrides: Partial<CatalogApi> = {}): CatalogApi {
  return {
    configured: true,
    getCatalog: vi.fn(async () => ({ services: [SWEDISH, { ...SWEDISH, id: 'static-only', dbId: null }], packages: [PACKAGE] })),
    getTherapists: vi.fn(async () => [ADA, { ...ADA, id: 'static', dbId: null }]),
    getDispatchZones: vi.fn(async () => fixture.zones),
    getTherapistServiceLinks: vi.fn(async () => fixture.links),
    getBusinessSettings: vi.fn(async () => fixture.settings),
    ...overrides,
  } as CatalogApi;
}

describe('loading the booking catalogue', () => {
  it('is ready with only bookable (database) items', async () => {
    const result = await loadBookingCatalog(api());
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.catalog.services.map((s) => s.dbId)).toEqual([SWEDISH.dbId]);
    expect(result.catalog.packages).toHaveLength(1);
    expect(result.catalog.therapists.map((t) => t.dbId)).toEqual([ADA.dbId]);
    expect(result.catalog.zones).toHaveLength(2);
    expect(result.catalog.settings.maxAdvanceDays).toBe(60);
  });

  it('is unavailable without a backend, without set-up data, or with online payment switched off', async () => {
    const offline = api({ configured: false });
    expect(await loadBookingCatalog(offline)).toEqual({ status: 'unavailable', reason: 'not_configured' });
    expect(offline.getCatalog).not.toHaveBeenCalled();

    expect(await loadBookingCatalog(api({ getBusinessSettings: vi.fn(async () => null) }))).toEqual({ status: 'unavailable', reason: 'not_set_up' });
    expect(await loadBookingCatalog(api({ getCatalog: vi.fn(async () => ({ services: [{ ...SWEDISH, dbId: null }], packages: [] })) }))).toEqual({
      status: 'unavailable', reason: 'not_set_up',
    });
    expect(await loadBookingCatalog(api({ getBusinessSettings: vi.fn(async () => ({ ...fixture.settings, onlinePaymentEnabled: false })) }))).toEqual({
      status: 'unavailable', reason: 'payments_off',
    });
  });

  it('reports an error when the backend fails, and can retry', async () => {
    let fail = true;
    const flaky = api({
      getDispatchZones: vi.fn(async () => {
        if (fail) throw new Error('network');
        return fixture.zones;
      }),
    });
    const { result } = renderHook(() => useBookingCatalog(flaky));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('error'));
    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
