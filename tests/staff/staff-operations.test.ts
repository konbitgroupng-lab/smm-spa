import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSupabaseBackend, messageFor, StaffError } from '../../src/staff/lib/backend';
import { STAFF_AUTH_OPTIONS } from '../../src/staff/lib/client';
import { conflictsOf, createSupabaseOps, type StaffOps } from '../../src/staff/lib/ops';
import { dateRange } from '../../src/staff/lib/time';
import { asRole, createStaff, createTestDb, one } from '../db/harness';
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

describe('schedule and catalogue end to end (5c)', () => {
  it('a closure over a booking comes back as a list to confirm; confirmed, the booking stays and is listed', async () => {
    const ops = await signedIn('admin@example.com');
    const options = await ops.bookingOptions();
    const swedish = options.services.find((s) => s.name === 'Swedish Massage')!;
    const day = upcoming(WED, 3);
    const slot = (await ops.availableSlots(swedish.id, day, null))[0];
    const { id } = await ops.createBooking({
      source: 'phone', settlement: 'pay_at_venue', serviceId: swedish.id, startsAt: slot.startsAt, therapistId: slot.therapistId,
      locationType: 'sanctuary', dispatchZoneId: null, serviceAddress: null, customerId: null, customerName: 'Closure Guest',
      customerEmail: null, customerPhone: '+2348035559999', contactName: null, contactPhone: null, bookingNotes: null, reason: 'Called to book',
    });
    const from = dateRange(day, day).from;
    const to = dateRange(day, day).to;
    const refused = await failure(ops.addBlackout(from, to, 'Public holiday', { reason: null, confirm: false }));
    expect(refused.code).toBe('confirmation_required');
    const summary = conflictsOf(refused)!;
    expect(summary.appointments).toEqual([expect.objectContaining({ id, contactName: 'Closure Guest', reasons: ['blackout'] })]);
    expect((await failure(ops.addBlackout(from, to, 'Public holiday', { reason: null, confirm: true }))).code).toBe('reason_required');
    const accepted = await ops.addBlackout(from, to, 'Public holiday', { reason: 'Declared a public holiday', confirm: true });
    expect(accepted.appointments.map((a) => a.id)).toEqual([id]);
    expect((await ops.scheduleConflicts()).find((c) => c.id === id)).toMatchObject({ reasons: ['blackout'], contactName: 'Closure Guest' });
    expect((await ops.appointmentDetail(id)).appointment.status).toBe('confirmed');
    const overview = await ops.scheduleOverview();
    await ops.removeBlackout(overview.blackouts.find((b) => b.note === 'Public holiday')!.id, null);
    expect((await ops.scheduleConflicts()).find((c) => c.id === id)).toBeUndefined();
  });

  it('catalogue edits carry their versions; therapists cannot reach any of it', async () => {
    const ops = await signedIn('admin@example.com');
    const before = (await ops.catalogue()).services.find((s) => s.slug === 'hot-stone')!;
    const input = {
      slug: before.slug, name: before.name, category: before.category, description: before.description, benefits: before.benefits,
      durationMinutes: before.durationMinutes, bufferMinutes: before.bufferMinutes, priceMinor: 5500000,
      compareAtPriceMinor: before.compareAtPriceMinor, isPopular: before.isPopular, isActive: true, sortOrder: before.sortOrder, isPackage: false,
    };
    await ops.saveService(before.id, before.updatedAt, input, { reason: null, confirm: false });
    expect((await ops.catalogue()).services.find((s) => s.id === before.id)!.priceMinor).toBe(5500000);
    expect((await failure(ops.saveService(before.id, before.updatedAt, input, { reason: null, confirm: false }))).code).toBe('stale_record');

    const therapist = await signedIn('therapist@example.com');
    expect((await failure(therapist.scheduleOverview())).code).toBe('not_authorized');
    expect((await failure(therapist.catalogue())).code).toBe('not_authorized');
    expect((await failure(therapist.addBlackout(new Date(Date.now() + 86_400_000).toISOString(), new Date(Date.now() + 2 * 86_400_000).toISOString(), null, { reason: null, confirm: false }))).code).toBe('not_authorized');
  });
});
describe('payments, refunds and staff end to end (5d)', () => {
  it('the owner invites through the Edge Function; admins cannot; duplicates are explained', async () => {
    await createStaff(db, 'owner5d@example.com', 'owner');
    const owner = await signedIn('owner5d@example.com');
    const { profileId } = await owner.inviteStaff('invited.e2e@example.com', 'Invited Person');
    const list = await owner.staffList();
    expect(list.staff.find((s) => s.id === profileId)).toMatchObject({ email: 'invited.e2e@example.com', fullName: 'Invited Person', isActive: false });
    // The function records the invitation as the owner (owner_record_invitation, called with named arguments).
    expect((await one(db, `select count(*)::int as n from audit_log where action = 'staff.invited' and entity_id = $1`, [profileId])).n).toBe(1);
    expect((await failure(owner.inviteStaff('invited.e2e@example.com', 'Invited Person'))).code).toBe('already_registered');
    expect((await failure(owner.inviteStaff('not an email', 'Someone'))).code).toBe('invalid_invitation');
    const admin = await signedIn('admin@example.com');
    expect((await failure(admin.inviteStaff('sneaky@example.com', 'Sneaky'))).code).toBe('not_authorized');
    expect((await failure(admin.staffList())).code).toBe('not_authorized');
  });

  it('the owner records a refund on a paid booking; the admin sees it but cannot record one', async () => {
    const hold = (await db.query<any>(`select * from request_booking_hold((select id from services where slug = 'swedish'), $1, null)`,
      [at(upcoming(WED, 4), '10:30').toISOString()])).rows[0];
    await db.query(`select attach_customer_to_hold($1, 'E2E Payer', 'e2e.payer@example.com', '+2348035551234')`, [hold.hold_token]);
    const p = (await db.query<any>(`select begin_hold_payment($1, 'mock', true) as p`, [hold.hold_token])).rows[0].p;
    await db.query(`select record_payment_result('mock', $1, 'success', $2, 'NGN')`, [p.reference, p.amount_minor]);

    const admin = await signedIn('admin@example.com');
    const row = (await admin.payments('succeeded', 50, 0)).rows.find((r) => r.reference === p.reference)!;
    expect(row).toMatchObject({ isDemo: true, guestName: 'E2E Payer' });
    expect((await failure(admin.recordRefund(row.id, 1000, 'cash', 'Goodwill', row.updatedAt, null, null))).code).toBe('not_authorized');

    const owner = await signedIn('owner5d@example.com');
    const detail = await owner.paymentDetail(row.id);
    await owner.recordRefund(row.id, 1000, 'cash', 'Goodwill gesture', detail.payment.updatedAt, 'RC-1', 'Handed over at reception');
    const after = await admin.paymentDetail(row.id);
    expect(after.payment).toMatchObject({ status: 'partially_refunded', refundedMinor: 1000 });
    expect(after.refunds).toEqual([expect.objectContaining({ method: 'cash', amountMinor: 1000, reference: 'RC-1' })]);
    expect((await failure(owner.recordRefund(row.id, 1000, 'cash', 'Again', detail.payment.updatedAt, null, null))).code).toBe('stale_record');
    const log = await admin.auditLog({ entityTypes: ['refund_records'], entityId: null, actionPrefix: 'payment.', beforeId: null, limit: 10 });
    expect(log[0]).toMatchObject({ action: 'payment.refund_recorded', reason: 'Goodwill gesture', actorRole: 'owner' });
  });

  it('settings: owner-only payment settings; the demo switch is read-only', async () => {
    const admin = await signedIn('admin@example.com');
    const s = await admin.settings();
    expect(s.allowDemoPayments).toBe(true);
    expect((await failure(admin.updatePaymentSettings(s.updatedAt, { onlinePaymentEnabled: false, paymentMode: 'full', depositPercent: 50 }, 'Trying'))).code).toBe('not_authorized');
    const owner = await signedIn('owner5d@example.com');
    await owner.updatePaymentSettings(s.updatedAt, { onlinePaymentEnabled: true, paymentMode: 'deposit', depositPercent: 40 }, 'Deposits now');
    expect(await admin.settings()).toMatchObject({ paymentMode: 'deposit', depositPercent: 40, allowDemoPayments: true });
    const back = await owner.settings();
    await owner.updatePaymentSettings(back.updatedAt, { onlinePaymentEnabled: true, paymentMode: 'full', depositPercent: 50 }, 'Back to full');
  });
});
describe('website content end to end (6b)', () => {
  it('contact details, FAQs, gallery, testimonials and announcements round-trip through the real content functions', async () => {
    const ops = await signedIn('admin@example.com');
    let c = await ops.content();
    expect(c.contact.updatedAt).not.toBeNull();

    // Contact details replace the block; an out-of-date version is refused.
    await ops.saveContact(c.contact.updatedAt, { address: 'Maryland, Lagos', phone: '+234 811 859 9365', whatsapp: '+2348118599365', email: null });
    const stale = c.contact.updatedAt;
    c = await ops.content();
    expect(c.contact).toMatchObject({ isPublished: true, value: { address: 'Maryland, Lagos', phone: '+234 811 859 9365', whatsapp: '+2348118599365', email: null } });
    expect((await failure(ops.saveContact(stale, { phone: '+234 811 859 9365' }))).code).toBe('stale_record');
    expect((await failure(ops.saveContact(c.contact.updatedAt, { phone: 'call us' }))).code).toBe('invalid_content');

    // A new FAQ starts hidden; shown, moved to the top, hidden again, deleted with a reason.
    const { id } = await ops.saveFaq(null, null, { question: 'Do you come to my home?', answer: ['Yes.', 'A travel fee applies.'] });
    c = await ops.content();
    let faq = c.faqs.find((f) => f.id === id)!;
    expect(faq).toMatchObject({ isPublished: false, answer: ['Yes.', 'A travel fee applies.'] });
    await ops.setPublished('faq', id, true, faq.updatedAt);
    await ops.reorder('faq', [id, ...c.faqs.filter((f) => f.id !== id).map((f) => f.id)]);
    c = await ops.content();
    expect(c.faqs[0]).toMatchObject({ id, isPublished: true });
    faq = c.faqs[0];
    expect((await failure(ops.deleteContent('faq', id, 'Not needed', faq.updatedAt))).code).toBe('still_published');
    await ops.setPublished('faq', id, false, faq.updatedAt);
    faq = (await ops.content()).faqs.find((f) => f.id === id)!;
    await ops.deleteContent('faq', id, 'Not needed', faq.updatedAt);
    expect((await ops.content()).faqs.some((f) => f.id === id)).toBe(false);

    // Gallery item with a built-in picture; testimonial; announcement with dates.
    const g = await ops.saveGalleryItem(null, null, { title: 'Treatment room', category: 'sanctuary', imageUrl: '/assets/images/room.jpg', imageMediaId: null });
    const t = await ops.saveTestimonial(null, null, { authorName: 'Tunde A.', authorLocation: 'Ikeja', body: 'Calm, professional and on time.', rating: 4, serviceId: null });
    const a = await ops.saveAnnouncement(null, null, { kind: 'promotion', title: 'December offer', body: '', startsAt: '2026-12-01T00:00:00+01:00', endsAt: '2026-12-31T23:59:00+01:00' });
    c = await ops.content();
    expect(c.gallery.find((x) => x.id === g.id)).toMatchObject({ previewUrl: '/assets/images/room.jpg', imageMediaId: null, isPublished: false });
    expect(c.testimonials.find((x) => x.id === t.id)).toMatchObject({ authorName: 'Tunde A.', rating: 4, isPublished: false });
    const ann = c.announcements.find((x) => x.id === a.id)!;
    expect(ann.kind).toBe('promotion');
    expect(new Date(ann.endsAt!).toISOString()).toBe('2026-12-31T22:59:00.000Z');
    expect((await failure(ops.saveGalleryItem(null, null, { title: 'Bad', category: 'sanctuary', imageUrl: 'https://evil.example/x.jpg', imageMediaId: null }))).code).toBe('invalid_content');

    // The homepage heading starts unpublished and can be saved hidden.
    await ops.saveHero(c.hero.updatedAt, { heading: 'Calm, on your terms', subheading: null }, false);
    expect((await ops.content()).hero).toMatchObject({ isPublished: false, value: { heading: 'Calm, on your terms', subheading: null } });

    const therapist = await signedIn('therapist@example.com');
    expect((await failure(therapist.content())).code).toBe('not_authorized');
    expect((await failure(therapist.saveFaq(null, null, { question: 'Sneaky question?', answer: ['No.'] }))).code).toBe('not_authorized');
  });
});

describe('guest bank transfers end to end', () => {
  it('admin lists and confirms a transfer through the real functions; the owner changes the account; therapists are refused', async () => {
    const swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
    const start = at(upcoming(WED, 3), '15:00').toISOString();
    const service = <T,>(fn: () => Promise<T>) => asRole(db, 'service_role', null, fn);
    const hold = await service(() => one(db, `select * from request_booking_hold($1, $2, null)`, [swedish, start]));
    await service(() => db.query(`select attach_customer_to_hold($1, 'Ops Transfer', 'ops.transfer@example.com', '+2348000000000')`, [hold.hold_token]));
    const view = (await service(() => one(db, `select request_transfer_booking($1) as r`, [hold.hold_token]))).r;

    const admin = await signedIn('admin@example.com');
    const listed = (await admin.transfers()).find((t) => t.reference === view.reference)!;
    expect(listed).toMatchObject({ amountMinor: 4_000_000, contactName: 'Ops Transfer', serviceName: 'Swedish Massage' });
    expect(listed.updatedAt).toMatch(/\d{2}:\d{2}:\d{2}/);
    await admin.confirmTransfer(listed.appointmentId, listed.updatedAt, 'Seen in the bank app');
    expect((await admin.transfers()).some((t) => t.reference === view.reference)).toBe(false);
    const detail = await admin.appointmentDetail(listed.appointmentId);
    expect(detail.appointment).toMatchObject({ status: 'confirmed', settlement: 'bank_transfer', paymentState: 'paid_transfer' });

    const settings = await admin.settings();
    expect(settings).toMatchObject({ transferEnabled: true, bankAccountNumber: '0013819712', transferHoldMinutes: 120 });
    expect((await failure(admin.updateTransferSettings(settings.updatedAt, { enabled: true, bankName: 'GTBank', accountNumber: '0123456789', accountName: 'SMM' }, 'Trying'))).code).toBe('not_authorized');

    const therapist = await signedIn('therapist@example.com');
    expect((await failure(therapist.transfers())).code).toBe('not_authorized');
  });
});
