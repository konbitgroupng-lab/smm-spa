import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSupabaseBackend } from '../../src/staff/lib/backend';
import { STAFF_AUTH_OPTIONS } from '../../src/staff/lib/client';
import { createSupabaseOps, type StaffOps } from '../../src/staff/lib/ops';
import { dateRange } from '../../src/staff/lib/time';
import { at, upcoming, MON, TUE } from '../db/dates';
import { createStaff, createTestDb, one, rows } from '../db/harness';
import { startLocalBackend } from '../support/local-backend';

// Phase 5e: the whole system end to end. A guest books and pays through the
// website's own services; staff then handle the booking through the staff
// app's own client: what each role sees, reschedule, cancellation, refund
// recording, schedule changes, and what the guest is told throughout.

const SITE = 'http://localhost:3000';
const PASSWORD = 'correct horse battery';
let db: PGlite;
let backend: { url: string; close(): Promise<void> };
let booking: typeof import('../../src/services/bookingService');
let pay: typeof import('../../src/services/paymentService');
let swedish: string;
let therapistA: string;

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) };
}
async function staff(email: string): Promise<StaffOps> {
  const client = createClient(backend.url, 'anon-key-for-tests', { auth: { ...STAFF_AUTH_OPTIONS, storage: memoryStorage() } });
  await createSupabaseBackend(client).signIn(email, PASSWORD);
  return createSupabaseOps(client);
}

/** A guest books therapist A at `time` on `date` and pays with the demo card. */
async function guestBooks(date: string, time: string, n: number) {
  const startsAt = at(date, time).toISOString();
  const hold = await booking.createHold({ serviceId: swedish, startsAt, therapistId: therapistA });
  await booking.attachCustomer(hold.token, { fullName: `Website Guest ${n}`, email: `web.guest${n}@example.com`, phone: '+2348000000123' });
  const start = await pay.startPayment(hold.token, { callbackUrl: `${SITE}/?view=payment-return`, notes: 'Lower back' });
  await pay.completeDemoCheckout(start.reference, 'success');
  const outcome = await pay.verifyPayment(start.reference);
  expect(outcome.status).toBe('confirmed');
  return { reference: start.reference, appointmentRef: outcome.appointment!.reference, startsAt };
}

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`delete from appointments`);
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  await createStaff(db, 'owner@example.com', 'owner');
  await createStaff(db, 'admin@example.com', 'admin');
  const therapistUser = await createStaff(db, 'therapist@example.com', 'therapist');
  therapistA = (await one(db, `update therapists set profile_id = $1 where sort_order = 1 returning id`, [therapistUser])).id;
  backend = await startLocalBackend(db, SITE, { staffPassword: PASSWORD });
  vi.stubEnv('VITE_SUPABASE_URL', backend.url);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-tests');
  // The staff modules above already loaded the (empty) settings: load the website's services afresh.
  vi.resetModules();
  booking = await import('../../src/services/bookingService');
  pay = await import('../../src/services/paymentService');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await backend?.close();
});

describe('a website booking handled by staff', () => {
  it('staff see it; reschedule, cancellation and refund keep the guest correctly informed', async () => {
    const date = upcoming(MON, 1);
    const g = await guestBooks(date, '10:30', 1);

    // What each role sees.
    const admin = await staff('admin@example.com');
    const listed = (await admin.appointments(dateRange(date, date).from, dateRange(date, date).to)).find((a) => a.reference === g.appointmentRef)!;
    expect(listed).toMatchObject({ source: 'online', settlement: 'online_payment', paymentState: 'paid', isDemo: true, contactName: 'Website Guest 1' });
    const therapist = await staff('therapist@example.com');
    const agenda = await therapist.agenda(dateRange(date, date).from, dateRange(date, date).to);
    expect(agenda.find((a) => a.reference === g.appointmentRef)).toMatchObject({ paymentState: 'paid', customerNotes: 'Lower back', contactName: 'Website Guest 1' });
    expect(JSON.stringify(agenda)).not.toContain('web.guest1@example.com');

    // Reschedule: the guest's confirmation follows the new time.
    const detail = await admin.appointmentDetail(listed.id);
    const newStart = at(date, '15:30').toISOString();
    await admin.reschedule(listed.id, newStart, 'Guest asked to come later', detail.appointment.updatedAt, null, false);
    const moved = await pay.verifyPayment(g.reference);
    expect(moved).toMatchObject({ status: 'confirmed' });
    expect(new Date(moved.appointment!.startsAt).toISOString()).toBe(newStart);
    expect((await booking.getAvailableSlots(swedish, date, therapistA)).some((s) => s.startsAt === g.startsAt)).toBe(true); // old time freed

    // Cancellation: the guest is told it is cancelled; the payment is flagged, not refunded.
    const before = await admin.appointmentDetail(listed.id);
    await admin.cancel(listed.id, 'Therapist unwell', before.appointment.updatedAt);
    expect(await pay.verifyPayment(g.reference)).toMatchObject({ status: 'cancelled', appointment: { reference: g.appointmentRef } });
    const queue = await admin.payments('refund_due', 50, 0);
    const flagged = queue.rows.find((p) => p.reference === g.reference)!;
    expect(flagged).toMatchObject({ needsRefundReason: 'appointment_cancelled', refundedMinor: 0, isDemo: true });

    // The owner records the refund made by bank transfer; the guest outcome stays "cancelled".
    const owner = await staff('owner@example.com');
    const p = await owner.paymentDetail(flagged.id);
    await owner.recordRefund(flagged.id, p.payment.refundableMinor, 'bank_transfer', 'Refunded after cancellation', p.payment.updatedAt, 'TRF-77', null);
    expect((await owner.paymentDetail(flagged.id)).payment).toMatchObject({ status: 'refunded', needsRefund: false });
    expect(await pay.verifyPayment(g.reference)).toMatchObject({ status: 'cancelled' });
    expect((await admin.payments('refund_due', 50, 0)).rows.some((r) => r.reference === g.reference)).toBe(false);

    // The cancelled time is bookable by another guest straight away.
    const again = await guestBooks(date, '15:30', 2);
    expect(again.appointmentRef).not.toBe(g.appointmentRef);
  });

  it('a schedule change over a website booking keeps it confirmed for the guest and lists it for staff', async () => {
    const date = upcoming(TUE, 1);
    const g = await guestBooks(date, '10:30', 3);
    const admin = await staff('admin@example.com');
    const day = dateRange(date, date);
    await admin.addBlackout(day.from, day.to, 'Generator repair', { reason: 'Power works all day', confirm: true });
    expect(await pay.verifyPayment(g.reference)).toMatchObject({ status: 'confirmed' });
    expect((await admin.scheduleConflicts()).find((c) => c.reference === g.appointmentRef)).toMatchObject({ reasons: ['blackout'] });
    expect(await booking.getAvailableSlots(swedish, date, therapistA)).toEqual([]);
    // No appointment was changed by the closure.
    expect(await rows(db, `select status from appointments where reference = $1`, [g.appointmentRef])).toEqual([{ status: 'confirmed' }]);
  });
});
