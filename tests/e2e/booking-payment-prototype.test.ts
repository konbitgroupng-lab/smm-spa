import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { resolveView } from '../../src/routes';
import { at, upcoming } from '../db/dates';
import { createTestDb, one, rows } from '../db/harness';
import { startLocalBackend } from '../support/local-backend';

// The prototype booking flow as the browser runs it: the frontend's own service
// modules (src/services) over HTTP to the real Edge Function handlers and
// database functions, with the demo payment gateway.

const SITE = 'http://localhost:3000';
const PRICE = 4_000_000;
let db: PGlite;
let backend: { url: string; close(): Promise<void> };
let booking: typeof import('../../src/services/bookingService');
let pay: typeof import('../../src/services/paymentService');
let supabase: typeof import('../../src/lib/supabase');
let swedish: string;
let A: string;

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`delete from appointments`);
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  A = (await one(db, `select id from therapists where sort_order = 1`)).id;
  backend = await startLocalBackend(db, SITE);
  vi.stubEnv('VITE_SUPABASE_URL', backend.url);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-tests');
  supabase = await import('../../src/lib/supabase');
  booking = await import('../../src/services/bookingService');
  pay = await import('../../src/services/paymentService');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await backend?.close();
});

let day = 0;
const nextDate = () => upcoming(1 + (day % 6), Math.floor(day++ / 6));
const callbackUrl = `${SITE}/?view=payment-return`;
let guest = 0;

/** Service -> date -> time -> hold -> details, as the prototype page does it. */
async function holdWithDetails(therapistId?: string) {
  const slots = await booking.getAvailableSlots(swedish, nextDate(), therapistId);
  expect(slots.length).toBeGreaterThan(0);
  const hold = await booking.createHold({ serviceId: swedish, startsAt: slots[0].startsAt, therapistId });
  await booking.attachCustomer(hold.token, { fullName: 'Prototype Guest', email: `prototype${++guest}@example.com`, phone: '+2348000000000' });
  return hold;
}

describe('booking prototype, end to end through the frontend services', () => {
  it('select -> hold -> details -> demo checkout -> success -> confirmed booking', async () => {
    const hold = await holdWithDetails();
    const start = await pay.startPayment(hold.token, { callbackUrl, notes: 'First visit' });
    expect(start).toMatchObject({ demo: true, provider: 'mock', amountMinor: PRICE, currency: 'NGN', kind: 'full' });

    // The checkout address opens the demo checkout page.
    const checkoutView = resolveView(new URL(start.checkoutUrl).search);
    expect(checkoutView).toEqual({ page: 'demo-checkout', reference: start.reference });
    expect(await pay.getDemoCheckout(start.reference)).toMatchObject({ demo: true, amountMinor: PRICE, status: 'abandoned' });

    // The guest pays; the provider sends them back to the return page.
    const { returnUrl } = await pay.completeDemoCheckout(start.reference, 'success');
    expect(resolveView(new URL(returnUrl!).search)).toEqual({ page: 'payment-return', reference: start.reference });

    const outcome = await pay.verifyPayment(start.reference);
    expect(outcome).toMatchObject({ status: 'confirmed', demo: true });
    const [appointment] = await rows(db, `select * from appointments where reference = $1`, [outcome.appointment!.reference]);
    expect(appointment).toMatchObject({ status: 'confirmed', is_demo: true, customer_notes: 'First visit', contact_name: 'Prototype Guest' });
    expect(new Date(appointment.starts_at).toISOString()).toBe(hold.startsAt);

    // The slot is no longer offered.
    const after = await booking.getAvailableSlots(swedish, new Date(hold.startsAt).toISOString().slice(0, 10), hold.therapistId);
    expect(after.some((s) => s.startsAt === hold.startsAt)).toBe(false);
  });

  it('a declined card books nothing; retrying from the same hold then succeeds', async () => {
    const hold = await holdWithDetails();
    const first = await pay.startPayment(hold.token, { callbackUrl });
    await pay.completeDemoCheckout(first.reference, 'decline');
    expect(await pay.verifyPayment(first.reference)).toMatchObject({ status: 'failed', appointment: null });
    expect(await rows(db, `select id from appointments where hold_id = (select id from booking_holds where hold_token = $1)`, [hold.token])).toEqual([]);

    const retry = await pay.startPayment(hold.token, { callbackUrl });
    expect(retry.reference).not.toBe(first.reference);
    await pay.completeDemoCheckout(retry.reference, 'success');
    expect(await pay.verifyPayment(retry.reference)).toMatchObject({ status: 'confirmed' });
  });

  it('a pending payment shows as pending, and the provider sending its notification twice books once', async () => {
    const hold = await holdWithDetails();
    const start = await pay.startPayment(hold.token, { callbackUrl });
    await pay.completeDemoCheckout(start.reference, 'pending');
    expect(await pay.verifyPayment(start.reference)).toMatchObject({ status: 'pending' });
    await pay.completeDemoCheckout(start.reference, 'success', 2);
    expect(await pay.verifyPayment(start.reference)).toMatchObject({ status: 'confirmed' });
    expect(await rows(db, `select id from appointments where hold_id = (select id from booking_holds where hold_token = $1)`, [hold.token])).toHaveLength(1);
  });

  it('an expired or released hold cannot be paid for', async () => {
    const expired = await holdWithDetails();
    await db.query(`update booking_holds set expires_at = now() - interval '1 second' where hold_token = $1`, [expired.token]);
    await expect(pay.startPayment(expired.token, { callbackUrl })).rejects.toMatchObject({ code: 'hold_expired' });

    const released = await holdWithDetails();
    expect(await booking.releaseHold(released.token)).toBe(true);
    await expect(pay.startPayment(released.token, { callbackUrl })).rejects.toMatchObject({ code: 'hold_expired' });
  });

  it('a hold without customer details cannot be paid for, and a stranger\'s reference reveals nothing', async () => {
    const slots = await booking.getAvailableSlots(swedish, nextDate());
    const bare = await booking.createHold({ serviceId: swedish, startsAt: slots[0].startsAt });
    await expect(pay.startPayment(bare.token, { callbackUrl })).rejects.toMatchObject({ code: 'customer_required' });
    await expect(pay.verifyPayment('SMMP-0000000000000000000000000000DEAD')).rejects.toMatchObject({ code: 'payment_not_found' });
  });

  it('the browser cannot book, pay or change amounts by calling the database directly', async () => {
    const hold = await holdWithDetails(A);
    const start = await pay.startPayment(hold.token, { callbackUrl });
    const client = supabase.requireSupabase();
    for (const [fn, args] of [
      ['record_payment_result', { p_provider: 'mock', p_reference: start.reference, p_status: 'success', p_paid_minor: PRICE, p_currency: 'NGN' }],
      ['mock_provider_complete', { p_reference: start.reference, p_outcome: 'success' }],
      ['begin_hold_payment', { p_hold_token: hold.token, p_provider: 'mock', p_is_test: true }],
      ['create_booking_hold', { p_service_id: swedish, p_therapist_id: A, p_starts_at: hold.startsAt }],
    ] as const) {
      const { error } = await client.rpc(fn, args);
      expect(error?.code).toBe('42501');
    }
    expect(await pay.verifyPayment(start.reference)).toMatchObject({ status: 'pending' });
    expect(await rows(db, `select id from appointments where hold_id = (select id from booking_holds where hold_token = $1)`, [hold.token])).toEqual([]);
  });
});

describe('page routing', () => {
  it('maps the query string to a page and ignores anything malformed', () => {
    expect(resolveView('')).toEqual({ page: 'site' });
    expect(resolveView('?view=booking-prototype')).toEqual({ page: 'site' }); // the prototype booking page is gone
    expect(resolveView('?view=payment-return&trxref=SMMP-ABC12345&reference=SMMP-ABC12345')).toEqual({ page: 'payment-return', reference: 'SMMP-ABC12345' });
    expect(resolveView('?view=demo-checkout&reference=SMMP-ABC12345')).toEqual({ page: 'demo-checkout', reference: 'SMMP-ABC12345' });
    expect(resolveView('?view=demo-checkout&reference=<script>')).toEqual({ page: 'site' });
    expect(resolveView('?view=admin')).toEqual({ page: 'site' });
  });
});