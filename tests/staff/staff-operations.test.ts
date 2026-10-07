import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSupabaseBackend, messageFor, StaffError } from '../../src/staff/lib/backend';
import { STAFF_AUTH_OPTIONS } from '../../src/staff/lib/client';
import { createSupabaseOps, type StaffOps } from '../../src/staff/lib/ops';
import { dateRange } from '../../src/staff/lib/time';
import { createStaff, createTestDb, one } from '../db/harness';
import { at, upcoming, WED } from '../db/dates';
import { startLocalBackend } from '../support/local-backend';

// The staff app's real data layer (supabase-js + createSupabaseOps), over
// HTTP, against the real 5b database functions.

const PASSWORD = 'correct horse battery';
let db: PGlite;
let backend: { url: string; close(): Promise<void> };
let therapistA: string;

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) };
}

async function signedIn(email: string): Promise<StaffOps> {
  const client = createClient(backend.url, 'local-anon-key', { auth: { ...STAFF_AUTH_OPTIONS, storage: memoryStorage() } });
  await createSupabaseBackend(client).signIn(email, PASSWORD);
  return createSupabaseOps(client);
}

async function failure(promise: Promise<unknown>): Promise<StaffError> {
  try {
    await promise;
  } catch (err) {
    return err as StaffError;
  }
  throw new Error('expected a failure');
}

beforeAll(async () => {
  db = await createTestDb();
  await createStaff(db, 'admin@example.com', 'admin');
  const therapistUser = await createStaff(db, 'therapist@example.com', 'therapist');
  therapistA = (await one(db, `update therapists set profile_id = $1 where sort_order = 1 returning id`, [therapistUser])).id;
  backend = await startLocalBackend(db, 'http://localhost:3000', { staffPassword: PASSWORD });
});

afterAll(async () => {
  await backend?.close();
});

describe('owner/admin operations end to end', () => {
  it('book by phone, move, edit, settle, look up the customer, cancel', async () => {
    const ops = await signedIn('admin@example.com');
    const options = await ops.bookingOptions();
    const swedish = options.services.find((s) => s.name === 'Swedish Massage')!;
    const day = upcoming(WED, 1);

    const slots = await ops.availableSlots(swedish.id, day, null);
    expect(slots.length).toBeGreaterThan(10);
    const slot = slots.find((s) => s.startsAt === at(day, '10:00').toISOString() && s.therapistId !== therapistA)!;

    const { id } = await ops.createBooking({
      source: 'phone', settlement: 'pay_at_venue', serviceId: swedish.id, startsAt: slot.startsAt, therapistId: slot.therapistId,
      locationType: 'sanctuary', dispatchZoneId: null, serviceAddress: null, customerId: null, customerName: 'Flow Guest',
      customerEmail: null, customerPhone: '+2348035550000', contactName: null, contactPhone: null, bookingNotes: 'Quiet room', reason: 'Called to book',
    });
    let detail = await ops.appointmentDetail(id);
    expect(detail.appointment).toMatchObject({ source: 'phone', settlement: 'pay_at_venue', paymentState: 'to_collect', contactName: 'Flow Guest', bookingNotes: 'Quiet room' });
    expect(detail.payments).toEqual([]);
    expect(detail.history[0]).toMatchObject({ action: 'appointment.created_by_staff', reason: 'Called to book', actorRole: 'admin' });
    expect(detail.appointment.updatedAt).toMatch(/\d{2}:\d{2}:\d{2}/);

    // The same slot is gone for guests.
    expect((await ops.availableSlots(swedish.id, day, slot.therapistId)).some((s) => s.startsAt === slot.startsAt)).toBe(false);

    // A rule refusal names the rule; an override moves it and is recorded.
    const onBreak = at(day, '13:00').toISOString();
    const refused = await failure(ops.reschedule(id, onBreak, 'Guest asked', detail.appointment.updatedAt, null, false));
    expect(refused).toMatchObject({ code: 'schedule_rule', detail: 'on_break' });
    expect(messageFor(refused)).toBe('That time is outside the booking rules: it falls in the therapist\'s break.');
    await ops.reschedule(id, onBreak, 'Therapist agreed', detail.appointment.updatedAt, null, true);
    detail = await ops.appointmentDetail(id);
    expect(new Date(detail.appointment.startsAt).toISOString()).toBe(onBreak);
    expect(detail.history.at(-1)).toMatchObject({ action: 'appointment.rescheduled', context: { override: true, overridden_rule: 'on_break' } });

    // Old versions are refused.
    const stale = await failure(ops.setSettlement(id, 'paid_offline', 'Transfer received', '2000-01-01T00:00:00+00:00'));
    expect(stale.code).toBe('stale_record');

    await ops.updateBookingDetails(id, detail.appointment.updatedAt, {
      contactName: 'Flow Driver', contactPhone: '+2348035550001', serviceAddress: null, bookingNotes: 'Quiet room', reason: null,
    });
    detail = await ops.appointmentDetail(id);
    await ops.setSettlement(id, 'paid_offline', 'Transfer received', detail.appointment.updatedAt);
    detail = await ops.appointmentDetail(id);
    expect(detail.appointment).toMatchObject({ contactName: 'Flow Driver', settlement: 'paid_offline', paymentState: 'paid_offline' });

    // The customer record kept its own details.
    const found = await ops.customers('flow guest', 10, 0);
    expect(found.total).toBe(1);
    const customer = await ops.customerDetail(found.rows[0].id);
    expect(customer.customer).toMatchObject({ fullName: 'Flow Guest', phone: '+2348035550000' });
    expect(customer.appointments[0]).toMatchObject({ contactName: 'Flow Driver', settlement: 'paid_offline' });
    await ops.updateCustomer(customer.customer.id, customer.customer.updatedAt, { fullName: 'Flow Guest', email: 'flow@example.com', phone: '+2348035550000', staffNotes: 'VIP', reason: null });
    expect((await ops.customerDetail(customer.customer.id)).customer.email).toBe('flow@example.com');

    const listed = await ops.appointments(dateRange(day, day).from, dateRange(day, day).to);
    expect(listed.find((a) => a.id === id)).toMatchObject({ contactName: 'Flow Driver', source: 'phone' });

    const result = await ops.cancel(id, 'Guest cancelled', detail.appointment.updatedAt);
    expect(result).toEqual({ refundFlagged: 0, settlement: 'paid_offline' });
    expect((await ops.availableSlots(swedish.id, day, slot.therapistId)).some((s) => s.startsAt === onBreak)).toBe(false); // break again
    expect((await ops.availableSlots(swedish.id, day, slot.therapistId)).some((s) => s.startsAt === slot.startsAt)).toBe(true); // freed

    const dash = await ops.dashboard();
    expect(dash.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('therapist operations end to end', () => {
  it('sees only their agenda and marks a started appointment completed; manager reads are refused', async () => {
    const customer = (await one(db, `select id from customers limit 1`)).id;
    const service = (await one(db, `select id from services where slug = 'swedish'`)).id;
    const started = await one(db, `insert into appointments (customer_id, service_id, therapist_id, starts_at, ends_at, blocked_until, status, price_minor, contact_name, contact_phone)
      values ($1, $2, $3, now() - interval '30 minutes', now() + interval '30 minutes', now() + interval '45 minutes', 'confirmed', 4000000, 'Agenda Guest', '+2348035550002') returning id`,
      [customer, service, therapistA]);
    const ops = await signedIn('therapist@example.com');
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const today = dateRange(day(-1), day(1));
    const agenda = await ops.agenda(today.from, today.to);
    expect(agenda.map((a) => a.id)).toContain(started.id);
    const item = agenda.find((a) => a.id === started.id)!;
    expect(item).toMatchObject({ contactName: 'Agenda Guest', paymentState: 'to_collect' });
    await ops.setStatus(item.id, 'completed', item.updatedAt);
    expect((await one(db, `select status from appointments where id = $1`, [started.id])).status).toBe('completed');

    expect((await failure(ops.appointments(today.from, today.to))).code).toBe('not_authorized');
    expect((await failure(ops.customers('', 10, 0))).code).toBe('not_authorized');
    expect((await failure(ops.setStatus(item.id, 'no_show', (await ops.agenda(today.from, today.to)).find((a) => a.id === item.id)!.updatedAt, 'oops'))).code).toBe('not_authorized');
  });
});
