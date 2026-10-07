// @vitest-environment jsdom
import type { PGlite } from '@electric-sql/pglite';
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatDateLong } from '../../src/booking/dates';
import { at, upcoming, FRI, MON, SAT, THU, TUE, WED } from '../db/dates';
import { asRole, createTestDb, one, rows } from '../db/harness';
import { startLocalBackend } from '../support/local-backend';
import { installBrowserStubs } from './browser-stubs';

// The whole website, as a guest uses it, against the real booking system:
// the site's own components and services, over HTTP, to the real Edge Function
// handlers and database functions, with demo payments.

// Each step makes real HTTP calls to an in-process database, and this file may
// share the machine with the other database suites: allow realistic time.
configure({ asyncUtilTimeout: 30_000 });
vi.setConfig({ testTimeout: 180_000 });

const SITE = 'http://localhost:3000';
let db: PGlite;
let backend: { url: string; close(): Promise<void> };
let AppRouter: ComponentType<{ search: string }>;
let browser: { assign: (url: string) => void };
let left: string[] = []; // addresses the site sent the guest to

beforeAll(async () => {
  installBrowserStubs();
  db = await createTestDb();
  await db.query(`delete from appointments`);
  backend = await startLocalBackend(db, SITE);
  vi.stubEnv('VITE_SUPABASE_URL', backend.url);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-tests');
  AppRouter = (await import('../../src/AppRouter')).default;
  browser = (await import('../../src/booking/navigation')).browser;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await backend?.close();
});

/** Opens a page of the site; navigation away from it is recorded, not followed. */
async function open(search = '') {
  left = [];
  vi.spyOn(browser, 'assign').mockImplementation((url: string) => void left.push(url));
  const user = userEvent.setup();
  render(<AppRouter search={search} />);
  return user;
}
const follow = async (url: string) => {
  cleanup();
  return open(new URL(url).search);
};

const funnel = () => screen.getByRole('navigation', { name: /booking steps/i }).parentElement!;
const times = () => within(screen.getByRole('list', { name: /available times/i })).getAllByRole('button');

async function chooseTreatment(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await screen.findByRole('navigation', { name: /booking steps/i });
  await user.click(within(funnel()).getByRole('radio', { name }));
}
async function chooseTherapistAndDate(user: ReturnType<typeof userEvent.setup>, therapist: RegExp | null, date: string) {
  await user.click(screen.getByRole('button', { name: /next: therapist/i }));
  if (therapist) await user.click(screen.getByRole('radio', { name: therapist }));
  await user.click(screen.getByRole('button', { name: /next: date/i }));
  await user.click(screen.getByRole('radio', { name: formatDateLong(date) }));
  await screen.findByRole('list', { name: /available times/i });
}
async function chooseTime(user: ReturnType<typeof userEvent.setup>, time: string) {
  await user.click(times().find((b) => b.textContent!.startsWith(time))!);
  await screen.findByRole('heading', { level: 3, name: /your details/i });
}
let guest = 0;
async function enterDetailsAndReview(user: ReturnType<typeof userEvent.setup>, name = 'Site Guest') {
  await user.type(screen.getByLabelText(/full name/i), name);
  await user.type(screen.getByLabelText(/^email/i), `site.guest${++guest}@example.com`);
  await user.type(screen.getByLabelText(/^phone/i), '+234 801 234 5678');
  await user.click(screen.getByRole('button', { name: /review & pay/i }));
  await screen.findByRole('heading', { level: 3, name: /review & pay/i });
}
/** Pay on the demo checkout and come back to the site's confirmation page. */
async function payOnDemoCheckout(user: ReturnType<typeof userEvent.setup>, choice: RegExp) {
  await user.click(screen.getByRole('button', { name: /continue to demo payment/i }));
  expect(left).toHaveLength(1);
  const checkout = new URL(left[0]);
  expect(checkout.origin).toBe(SITE);
  expect(checkout.searchParams.get('view')).toBe('demo-checkout');
  const demo = await follow(left[0]);
  await demo.click(await screen.findByRole('button', { name: choice }));
  await waitFor(() => expect(left).toHaveLength(1));
  expect(new URL(left[0]).searchParams.get('view')).toBe('payment-return');
  return follow(left[0]);
}
const appointmentByReference = (reference: string) => one(db, `select * from appointments where reference = $1`, [reference]);

describe('booking through the website', () => {
  it('specific therapist, at the sanctuary, paid by demo card: confirmed', async () => {
    const user = await open();
    await chooseTreatment(user, /swedish massage/i);
    await chooseTherapistAndDate(user, /senior massage therapist/i, upcoming(MON));
    await chooseTime(user, '10:00');
    await enterDetailsAndReview(user, 'Ngozi Example');
    expect(screen.getByText(/demo payment — no real money will be charged/i)).toBeTruthy();
    expect(screen.getByTestId('amount-due').textContent).toBe('₦40,000');

    await payOnDemoCheckout(user, /simulate a successful card/i);
    expect(await screen.findByRole('heading', { level: 1, name: /your booking is confirmed/i })).toBeTruthy();
    const reference = screen.getByText(/^SMM-/).textContent!;
    const appointment = await appointmentByReference(reference);
    const therapist = await one(db, `select display_name from therapists where id = $1`, [appointment.therapist_id]);
    expect(therapist.display_name).toBe('Senior Massage Therapist');
    expect(appointment).toMatchObject({ status: 'confirmed', location_type: 'sanctuary', contact_name: 'Ngozi Example', is_demo: true });
    expect(new Date(appointment.starts_at).toISOString()).toBe(at(upcoming(MON), '10:00').toISOString());
  });

  it('any therapist, in-home with area and address: the travel fee is charged by the server', async () => {
    const user = await open();
    await chooseTreatment(user, /swedish massage/i);
    await user.click(screen.getByRole('radio', { name: /mobile in-home spa/i }));
    const zone = (await one(db, `select id from dispatch_zones where key = 'vi'`)).id;
    await user.selectOptions(screen.getByLabelText(/your area/i), zone);
    await user.type(screen.getByLabelText(/street address/i), '12 Example Street, Victoria Island');
    await chooseTherapistAndDate(user, null, upcoming(TUE));
    await chooseTime(user, '14:00');
    await enterDetailsAndReview(user);
    expect(screen.getByTestId('amount-due').textContent).toBe('₦48,000');

    await payOnDemoCheckout(user, /simulate a successful card/i);
    await screen.findByRole('heading', { level: 1, name: /confirmed/i });
    const appointment = await appointmentByReference(screen.getByText(/^SMM-/).textContent!);
    expect(appointment).toMatchObject({ location_type: 'mobile', dispatch_zone_id: zone, service_address: '12 Example Street, Victoria Island' });
    expect(Number(appointment.total_minor)).toBe(4_800_000);
  });

  it('"Book This Package" on a package card preselects it, and the server prices it', async () => {
    const user = await open();
    await screen.findByRole('navigation', { name: /booking steps/i });
    await waitFor(() => expect(screen.getAllByRole('button', { name: /book this package/i }).length).toBe(3));
    await user.click(screen.getAllByRole('button', { name: /book this package/i })[0]);
    await waitFor(() => expect((within(funnel()).getByRole('radio', { name: /essential escape/i }) as HTMLInputElement).checked).toBe(true));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /schedule your therapy/i }));
    await chooseTherapistAndDate(user, null, upcoming(WED));
    await chooseTime(user, '09:00');
    await enterDetailsAndReview(user);
    expect(screen.getByTestId('amount-due').textContent).toBe('₦80,000');
  });

  it('a service card\'s "Book" button preselects that treatment, replacing an earlier choice', async () => {
    const user = await open();
    await chooseTreatment(user, /swedish massage/i);
    const cards = screen.getAllByRole('button', { name: /select & customize booking/i });
    const hotStoneCard = cards.find((b) => b.closest('div.group')!.textContent!.includes('Hot Stone Therapy'))!;
    await user.click(hotStoneCard);
    await waitFor(() => expect((within(funnel()).getByRole('radio', { name: /hot stone therapy/i }) as HTMLInputElement).checked).toBe(true));
    expect((within(funnel()).getByRole('radio', { name: /swedish massage/i }) as HTMLInputElement).checked).toBe(false);
  });

  it('changing the time replaces the hold, and the guest sees their own reserved time', async () => {
    const user = await open();
    await chooseTreatment(user, /swedish massage/i);
    await chooseTherapistAndDate(user, /senior massage therapist/i, upcoming(THU));
    await chooseTime(user, '10:00');
    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(await screen.findByRole('button', { name: '10:00, reserved for you' })).toBeTruthy();
    await chooseTime(user, '16:00');

    const holds = await rows(db, `select status, starts_at from booking_holds where therapist_id = (select id from therapists where sort_order = 1) and starts_at::date = $1::date order by created_at`, [upcoming(THU)]);
    expect(holds.map((h) => h.status)).toEqual(['released', 'active']);
    expect(new Date(holds[1].starts_at).toISOString()).toBe(at(upcoming(THU), '16:00').toISOString());
  });

  it('a time taken by another guest between steps: explained, and the times are refreshed', async () => {
    const user = await open();
    await chooseTreatment(user, /swedish massage/i);
    await chooseTherapistAndDate(user, /senior massage therapist/i, upcoming(FRI));
    const therapist = (await one(db, `select id from therapists where sort_order = 1`)).id;
    const swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
    await asRole(db, 'service_role', null, () => db.query(`select request_booking_hold($1, $2, $3)`, [swedish, at(upcoming(FRI), '11:00').toISOString(), therapist]));

    await user.click(times().find((b) => b.textContent === '11:00')!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/just been booked by someone else/i);
    await waitFor(() => expect(times().some((b) => b.textContent === '11:00')).toBe(false));
    expect(screen.getByRole('heading', { level: 3, name: /date & time/i })).toBeTruthy();
  });

  it('a hold that expired before payment: the guest is told and returned to choose a time', async () => {
    const user = await open();
    await chooseTreatment(user, /deep tissue massage/i);
    await chooseTherapistAndDate(user, null, upcoming(SAT));
    await chooseTime(user, '09:30');
    await db.query(`update booking_holds set expires_at = now() - interval '1 second' where status = 'active' and starts_at = $1`, [at(upcoming(SAT), '09:30').toISOString()]);
    await user.type(screen.getByLabelText(/full name/i), 'Late Guest');
    await user.type(screen.getByLabelText(/^email/i), 'late.guest@example.com');
    await user.type(screen.getByLabelText(/^phone/i), '+234 801 234 5678');
    await user.click(screen.getByRole('button', { name: /review & pay/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/reserved time ran out/i);
    expect(screen.getByRole('heading', { level: 3, name: /date & time/i })).toBeTruthy();
    expect(await rows(db, `select id from payments where hold_id in (select id from booking_holds where starts_at = $1)`, [at(upcoming(SAT), '09:30').toISOString()])).toEqual([]);
  });

  it('a declined demo card, then "Try paying again": confirmed', async () => {
    const user = await open();
    await chooseTreatment(user, /thai massage/i);
    await chooseTherapistAndDate(user, null, upcoming(MON, 1));
    await chooseTime(user, '11:00');
    await enterDetailsAndReview(user);
    const page = await payOnDemoCheckout(user, /simulate a declined card/i);
    expect(await screen.findByRole('heading', { level: 1, name: /your payment did not go through/i })).toBeTruthy();
    expect(screen.getByText(/have not been charged/i)).toBeTruthy();

    left = [];
    await page.click(screen.getByRole('button', { name: /try paying again/i }));
    await waitFor(() => expect(left).toHaveLength(1));
    expect(new URL(left[0]).searchParams.get('view')).toBe('demo-checkout');
    const retry = await follow(left[0]);
    await retry.click(await screen.findByRole('button', { name: /simulate a successful card/i }));
    await waitFor(() => expect(left).toHaveLength(1));
    await follow(left[0]);
    expect(await screen.findByRole('heading', { level: 1, name: /your booking is confirmed/i })).toBeTruthy();
    const payments = await rows(db, `select status from payments where hold_id = (select hold_id from appointments where reference = $1) order by created_at`, [screen.getByText(/^SMM-/).textContent]);
    expect(payments.map((p) => p.status)).toEqual(['failed', 'succeeded']);
  });

  it('a payment still pending: the confirmation page says so, and nothing is booked yet', async () => {
    const user = await open();
    await chooseTreatment(user, /premium facial treatment/i);
    await chooseTherapistAndDate(user, null, upcoming(TUE, 1));
    await chooseTime(user, '14:00');
    await enterDetailsAndReview(user);
    await payOnDemoCheckout(user, /bank transfer that is still pending/i);
    expect(await screen.findByRole('heading', { level: 1, name: /waiting for payment confirmation/i })).toBeTruthy();
    expect(screen.getByText(/demo payment — no real money will be charged/i)).toBeTruthy();
    expect(await rows(db, `select id from appointments where starts_at = $1`, [at(upcoming(TUE, 1), '14:00').toISOString()])).toEqual([]);
  });

  it('with online payment switched off, the booking area offers contact details instead', async () => {
    await db.query(`update business_settings set online_payment_enabled = false`);
    try {
      await open();
      expect(await within(document.getElementById('booking')!).findByRole('heading', { name: /online booking is unavailable/i })).toBeTruthy();
      expect(document.getElementById('services')).not.toBeNull(); // the rest of the site is unaffected
    } finally {
      await db.query(`update business_settings set online_payment_enabled = true`);
    }
  });

  it('nothing is written to localStorage during a whole booking', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const user = await open();
    await chooseTreatment(user, /swedish massage/i);
    await chooseTherapistAndDate(user, null, upcoming(WED, 1));
    await chooseTime(user, '16:00');
    await enterDetailsAndReview(user);
    await payOnDemoCheckout(user, /simulate a successful card/i);
    await screen.findByRole('heading', { level: 1, name: /confirmed/i });
    expect(setItem.mock.contexts.filter((store) => store === localStorage)).toEqual([]);
    // sessionStorage holds only the retry memory for this tab, which is removed once confirmed.
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith('smm_payment_'))).toEqual([]);
  });
});
