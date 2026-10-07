// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BookingSection from '../../../src/booking/components/BookingSection';
import type { CatalogApi } from '../../../src/booking/useBookingCatalog';
import { ADA, makeApi, makeCatalog, PACKAGE, SWEDISH } from '../fixtures';

afterEach(cleanup);

const fixture = makeCatalog();
function catalogApi(overrides: Partial<CatalogApi> = {}): CatalogApi {
  return {
    configured: true,
    getCatalog: vi.fn(async () => ({ services: [SWEDISH], packages: [PACKAGE] })),
    getTherapists: vi.fn(async () => [ADA]),
    getDispatchZones: vi.fn(async () => fixture.zones),
    getTherapistServiceLinks: vi.fn(async () => fixture.links),
    getBusinessSettings: vi.fn(async () => fixture.settings),
    ...overrides,
  } as CatalogApi;
}

describe('booking section', () => {
  it('without a backend, offers WhatsApp and phone instead of the funnel', async () => {
    render(<BookingSection catalogApi={catalogApi({ configured: false })} />);
    expect(await screen.findByRole('heading', { name: /online booking is unavailable/i })).toBeTruthy();
    const whatsapp = screen.getByRole('link', { name: /book on whatsapp/i });
    expect(whatsapp.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/2348118599365\?/);
    expect(whatsapp.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByRole('link', { name: /call \+234 811 859 9365/i }).getAttribute('href')).toBe('tel:+2348118599365');
    expect(screen.queryByRole('navigation', { name: /booking steps/i })).toBeNull();
  });

  it('also offers contact details when online payment is switched off', async () => {
    render(<BookingSection catalogApi={catalogApi({ getBusinessSettings: vi.fn(async () => ({ ...fixture.settings, onlinePaymentEnabled: false })) })} />);
    expect(await screen.findByRole('heading', { name: /online booking is unavailable/i })).toBeTruthy();
  });

  it('shows a loading state, then the funnel', async () => {
    render(<BookingSection catalogApi={catalogApi()} funnelApi={makeApi()} navigate={vi.fn()} callbackUrl="http://localhost:3000/?view=payment-return" />);
    expect(screen.getByRole('status').textContent).toMatch(/loading/i);
    expect(await screen.findByRole('navigation', { name: /booking steps/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /swedish massage/i })).toBeTruthy();
  });

  it('reports a failure to load and can retry', async () => {
    let fail = true;
    const api = catalogApi({
      getCatalog: vi.fn(async () => {
        if (fail) throw new Error('offline');
        return { services: [SWEDISH], packages: [] };
      }),
    });
    render(<BookingSection catalogApi={api} funnelApi={makeApi()} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load online booking/i);
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.getByRole('navigation', { name: /booking steps/i })).toBeTruthy());
  });

  it('starts on a preselected treatment', async () => {
    render(<BookingSection catalogApi={catalogApi()} funnelApi={makeApi()} preselectServiceId={PACKAGE.dbId} />);
    const radio = (await screen.findByRole('radio', { name: /essential escape/i })) as HTMLInputElement;
    expect(radio.checked).toBe(true);
  });
});
