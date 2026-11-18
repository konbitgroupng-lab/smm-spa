// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import AppRouter from '../../src/AppRouter';
import { installBrowserStubs } from './browser-stubs';

// The whole website with no backend configured (as the live site is today):
// it must render normally, with the booking section offering contact details.

// The booking section's code loads on demand: allow it time to arrive.
configure({ asyncUtilTimeout: 15_000 });

const root = path.resolve(__dirname, '../..');
beforeAll(installBrowserStubs);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('the website without a backend', () => {
  it('renders every section, with "online booking unavailable" in the booking area', async () => {
    render(<AppRouter search="" />);
    expect(screen.getByRole('heading', { name: /schedule your therapy/i })).toBeTruthy();
    for (const section of ['about', 'services', 'packages', 'booking', 'gallery', 'video-gallery', 'therapists', 'faqs']) {
      expect(document.getElementById(section), section).not.toBeNull();
    }
    // Service and package cards keep their static content.
    expect(screen.getAllByRole('button', { name: /select & customize booking/i }).length).toBe(6);
    // Couples and four-hands massages need two therapists: booked on WhatsApp, not online.
    const couples = document.getElementById('packages')!;
    const whatsapp = within(couples).getAllByRole('link', { name: /book on whatsapp/i });
    expect(whatsapp.map((a) => decodeURIComponent(new URL(a.getAttribute('href')!).searchParams.get('text')!))).toEqual([
      'Hello, I would like to book the Couples Swedish Massage (65 mins, ₦65,000). Please let me know the available times.',
      'Hello, I would like to book the Four Hands Swedish Massage (65 mins, ₦66,000). Please let me know the available times.',
      'Hello, I would like to book the Couples Deep Tissue Massage (65 mins, ₦70,000). Please let me know the available times.',
    ]);
    expect(screen.queryByRole('button', { name: /book this package/i })).toBeNull();
    // The client's prices.
    expect(screen.getAllByText('₦33,000').length).toBeGreaterThan(0);
    expect(screen.queryByText(/nuru/i)).toBeNull();
    expect(screen.getByRole('link', { name: /view the full price list/i }).getAttribute('href')).toBe('/?view=prices');
    expect(await within(document.getElementById('booking')!).findByRole('heading', { name: /online booking is unavailable/i })).toBeTruthy();
  });

  it('has none of the old booking form, its saved bookings, or the My Bookings section', () => {
    render(<AppRouter search="" />);
    expect(screen.queryByText(/booking cart/i)).toBeNull();
    expect(screen.queryByText(/my saved sessions/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /my bookings/i })).toBeNull();
    expect(document.getElementById('my-bookings')).toBeNull();
    const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
    for (const legacy of ['everest_bookings', 'localStorage', 'handleCompleteBooking', 'bookingStep', 'my-bookings']) expect(app).not.toContain(legacy);
  });

  it('a card\'s "Book" button takes the guest to the booking section and its heading', async () => {
    render(<AppRouter search="" />);
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    await userEvent.setup().click(screen.getAllByRole('button', { name: /select & customize booking/i })[0]);
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('booking'));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /schedule your therapy/i }));
  });

  it('the floating "Spa Appointments" button goes to the booking section; Calendly is gone', async () => {
    render(<AppRouter search="" />);
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /spa appointments/i }));
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('booking'));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /schedule your therapy/i }));
    expect(document.querySelector('script[src*="calendly"], link[href*="calendly"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: /dismiss booking shortcut/i }));
    expect(screen.queryByRole('button', { name: /spa appointments/i })).toBeNull();
  });

  it('going to booking closes the WhatsApp chat panel so it cannot cover the booking steps', async () => {
    render(<AppRouter search="" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /chat with us on whatsapp/i }));
    expect(screen.getByRole('button', { name: /close chat/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /spa appointments/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /close chat/i })).toBeNull());
  });

  it('the "Spa Appointments" shortcut hides while the booking section is on screen', async () => {
    let report: (entries: { isIntersecting: boolean }[]) => void = () => undefined;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof report) { report = callback; }
      observe() {}
      disconnect() {}
    });
    try {
      render(<AppRouter search="" />);
      expect(screen.getByRole('button', { name: /spa appointments/i })).toBeTruthy();
      await waitFor(() => report([{ isIntersecting: true }]));
      await waitFor(() => expect(screen.queryByRole('button', { name: /spa appointments/i })).toBeNull());
      // Several changes reported together: the last one counts.
      report([{ isIntersecting: true }, { isIntersecting: false }]);
      await waitFor(() => expect(screen.getByRole('button', { name: /spa appointments/i })).toBeTruthy());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('writes nothing to localStorage while the site is used', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<AppRouter search="" />);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /select & customize booking/i })[0]);
    await user.click(screen.getByRole('button', { name: /spa appointments/i }));
    const localWrites = setItem.mock.contexts.filter((store) => store === localStorage);
    expect(localWrites).toEqual([]);
  });

});

describe('routing', () => {
  it('the payment return address opens the booking confirmation page', async () => {
    render(<AppRouter search="?view=payment-return&trxref=SMMP-ABCDEF0123456789&reference=SMMP-ABCDEF0123456789" />);
    // With no backend the payment cannot be checked; the page says so instead of failing.
    expect(await screen.findByRole('heading', { level: 1, name: /could not check your payment/i })).toBeTruthy();
    expect(screen.getByText('SMMP-ABCDEF0123456789')).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to website/i })).toBeTruthy();
  });

  it('the demo checkout is still reachable and clearly marked as a demo', async () => {
    render(<AppRouter search="?view=demo-checkout&reference=SMMP-ABCDEF0123456789" />);
    expect(await screen.findByText(/demo payment — no real money will be charged/i)).toBeTruthy();
    expect(screen.getByRole('heading', { name: /demo checkout/i })).toBeTruthy();
  });

  it('the removed prototype booking page now shows the website', () => {
    render(<AppRouter search="?view=booking-prototype" />);
    expect(screen.getByRole('heading', { name: /schedule your therapy/i })).toBeTruthy();
    expect(screen.queryByText(/development prototype/i)).toBeNull();
  });

  it('nothing in the booking code, the site or the router depends on the prototype folder except the demo checkout', () => {
    const files = ['src/App.tsx', 'src/AppRouter.tsx', 'src/main.tsx', 'src/components/SpaBookingWidget.tsx',
      ...['BookingConfirmationPage.tsx', 'funnel.ts', 'useBookingFunnel.ts', 'useBookingCatalog.ts', 'navigation.ts', 'pendingPayment.ts', 'legacyStorage.ts', 'useSiteCatalog.ts'].map((f) => `src/booking/${f}`)];
    for (const file of files) {
      const imports = [...readFileSync(path.join(root, file), 'utf8').matchAll(/from '([^']+)'|import\('([^']+)'\)/g)].map((m) => m[1] ?? m[2]);
      const prototypeImports = imports.filter((i) => i.includes('prototype'));
      expect(prototypeImports, file).toEqual(file === 'src/AppRouter.tsx' ? ['./prototype/DemoCheckoutPage'] : []);
    }
    expect(within(document.body).queryByText(/booking-prototype/)).toBeNull();
  });
});

// Runs last: importing main.tsx boots a second copy of the site into the page.
describe('site start-up', () => {
  it('clears the old form\'s saved bookings from the browser when the site loads', async () => {
    localStorage.setItem('everest_bookings', JSON.stringify([{ client: { name: 'Old Guest', phone: '+234...' } }]));
    localStorage.setItem('unrelated', 'kept');
    document.body.innerHTML = '<div id="root"></div>';
    await import('../../src/main');
    expect(localStorage.getItem('everest_bookings')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('kept');
    await waitFor(() => expect(document.getElementById('booking')).not.toBeNull());
    document.body.innerHTML = ''; // main.tsx mounted its own copy of the site
  });
});
