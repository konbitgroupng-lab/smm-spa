import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createStaff, createTestDb, one, rows } from './harness';
import { at, upcoming } from './dates';

// Database-level tests for the payment state machine. The provider is not
// involved here: record_payment_result() is given the verdict a provider would
// have returned. Swedish massage is ₦40,000 (4,000,000 kobo), 60 minutes.

let db: PGlite;
let swedish: string;
let A: string;
let B: string;
let viZone: string;
const PRICE = 4_000_000;

// A fresh slot for every test: Mon-Sat over six weeks, five times a day, spaced
// so that a test booking 30 minutes after its slot never reaches the next one.
let slotIndex = 0;
const TIMES = ['09:00', '11:00', '14:00', '16:00', '18:00'];
function nextSlot(): Date {
  const i = slotIndex++;
  return at(upcoming(1 + (Math.floor(i / TIMES.length) % 6), Math.floor(i / (TIMES.length * 6))), TIMES[i % TIMES.length]);
}

const service = <T>(fn: () => Promise<T>) => asRole(db, 'service_role', null, fn);
let guest = 0;

interface HoldOptions { therapist?: string; mobile?: boolean; email?: string; name?: string; phone?: string; start?: Date }
/** A live hold with customer details attached: ready for payment. */
async function readyHold(options: HoldOptions = {}) {
  const start = options.start ?? nextSlot();
  const hold = await service(() =>
    one(db, `select * from request_booking_hold($1, $2, $3, $4, $5)`, [
      swedish, start.toISOString(), options.therapist ?? A, options.mobile ? 'mobile' : 'sanctuary', options.mobile ? viZone : null,
    ]),
  );
  return service(() =>
    one(db, `select * from attach_customer_to_hold($1, $2, $3, $4)`, [
      hold.hold_token, options.name ?? 'Test Guest', options.email ?? `guest${++guest}@example.com`, options.phone ?? '+2348000000000',
    ]),
  );
}

const begin = async (hold: any, address: string | null = null, notes: string | null = null) =>
  (await service(() => one(db, `select begin_hold_payment($1, 'paystack', true, $2, $3) as r`, [hold.hold_token, address, notes]))).r;

interface Verdict { paid?: number; currency?: string; reason?: string }
const record = async (reference: string, status: string, v: Verdict = {}) =>
  (
    await service(() =>
      one(db, `select record_payment_result('paystack', $1, $2, $3, $4, now(), 'TX-1', 'card', $5) as r`, [
        reference, status, status === 'success' ? v.paid ?? PRICE : null, status === 'success' ? v.currency ?? 'NGN' : null, v.reason ?? null,
      ]),
    )
  ).r;

const payment = (reference: string) => one(db, `select * from payments where provider_reference = $1`, [reference]);
const holdRow = (id: string) => one(db, `select * from booking_holds where id = $1`, [id]);
const appointmentsFor = (holdId: string) => rows(db, `select * from appointments where hold_id = $1`, [holdId]);
const expire = (holdId: string) => db.query(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [holdId]);
const minutesFromNow = (ts: string) => (new Date(ts).getTime() - Date.now()) / 60_000;

async function reasonFor(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err: any) {
    return err.message;
  }
  return 'no error';
}

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`delete from appointments`);
  await db.query(`update business_settings set online_payment_enabled = true, payment_mode = 'full'`);
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  A = (await one(db, `select id from therapists where sort_order = 1`)).id;
  B = (await one(db, `select id from therapists where sort_order = 2`)).id;
  viZone = (await one(db, `select id from dispatch_zones where key = 'vi'`)).id; // ₦8,000 fee
});

describe('starting a payment', () => {
  it('creates one payment for the full, database-calculated amount and snapshots the price', async () => {
    const hold = await readyHold();
    const started = await begin(hold, null, 'Please use light pressure');
    expect(started).toMatchObject({ is_new: true, amount_minor: PRICE, booking_total_minor: PRICE, currency: 'NGN', kind: 'full', checkout_url: null });
    expect(started.reference).toMatch(/^SMMP-[0-9A-F]{32}$/);
    expect(started.email).toMatch(/@example\.com$/);

    expect(await payment(started.reference)).toMatchObject({ status: 'initialized', hold_id: hold.id, appointment_id: null, is_test: true, needs_refund: false, refund_status: 'none' });
    expect(await holdRow(hold.id)).toMatchObject({ currency: 'NGN', customer_notes: 'Please use light pressure' });
    expect(Number((await holdRow(hold.id)).price_minor)).toBe(PRICE);
  });

  it('charges the configured deposit, rounded up to a whole kobo', async () => {
    await db.query(`update business_settings set payment_mode = 'deposit', deposit_percent = 50`);
    const half = await begin(await readyHold());
    await db.query(`update business_settings set deposit_percent = 33`);
    await db.query(`update services set price_minor = 4000001 where id = $1`, [swedish]);
    const third = await begin(await readyHold());
    await db.query(`update services set price_minor = $2 where id = $1`, [swedish, PRICE]);
    await db.query(`update business_settings set payment_mode = 'full', deposit_percent = 50`);

    expect(half).toMatchObject({ amount_minor: 2_000_000, booking_total_minor: PRICE, kind: 'deposit' });
    expect(third).toMatchObject({ amount_minor: 1_320_001, booking_total_minor: 4_000_001, kind: 'deposit' }); // 1,320,000.33 rounded up
  });

  it('adds the dispatch fee for mobile bookings and requires an address', async () => {
    const hold = await readyHold({ mobile: true });
    expect(await reasonFor(begin(hold))).toBe('address_required');
    const started = await begin(hold, '12 Example Street, Victoria Island');
    expect(started).toMatchObject({ amount_minor: PRICE + 800_000, booking_total_minor: PRICE + 800_000 });
    expect(Number((await holdRow(hold.id)).dispatch_fee_minor)).toBe(800_000);
  });

  it('returns the same open payment when called again', async () => {
    const hold = await readyHold();
    const first = await begin(hold);
    const second = await begin(hold);
    expect(second).toMatchObject({ is_new: false, reference: first.reference });
    expect(await rows(db, `select id from payments where hold_id = $1`, [hold.id])).toHaveLength(1);
  });

  it('extends the hold once to 15 minutes, and never again', async () => {
    const hold = await readyHold();
    await db.query(`update booking_holds set expires_at = now() + interval '1 minute' where id = $1`, [hold.id]); // guest pays at minute 9
    const first = await begin(hold);
    expect(minutesFromNow(first.hold_expires_at)).toBeGreaterThan(14.5);
    expect(minutesFromNow(first.hold_expires_at)).toBeLessThanOrEqual(15);

    // Repeating the call, and retrying after a failure, leave the expiry where it is.
    await db.query(`update booking_holds set expires_at = now() + interval '2 minutes' where id = $1`, [hold.id]);
    expect(minutesFromNow((await begin(hold)).hold_expires_at)).toBeLessThanOrEqual(2);
    await record(first.reference, 'failed');
    const retry = await begin(hold);
    expect(retry.is_new).toBe(true);
    expect(minutesFromNow(retry.hold_expires_at)).toBeLessThanOrEqual(2);
  });

  it('refuses when payments are off, details are missing or the hold is gone', async () => {
    const bare = await service(() => one(db, `select * from request_booking_hold($1, $2, $3)`, [swedish, nextSlot().toISOString(), A]));
    expect(await reasonFor(begin(bare))).toBe('customer_required');

    const hold = await readyHold();
    await db.query(`update business_settings set online_payment_enabled = false`);
    expect(await reasonFor(begin(hold))).toBe('payments_disabled');
    await db.query(`update business_settings set online_payment_enabled = true`);

    await expire(hold.id);
    expect(await reasonFor(begin(hold))).toBe('hold_expired');
    expect(await rows(db, `select id from payments where hold_id = $1`, [hold.id])).toEqual([]);
  });
});

describe('successful payment', () => {
  it('creates the confirmed appointment, consumes the hold and links the payment, in one step', async () => {
    const hold = await readyHold({ name: 'Ngozi Example', phone: '+2348011111111' });
    const { reference } = await begin(hold, null, 'Allergic to lavender');
    const outcome = await record(reference, 'success');

    const [appointment] = await appointmentsFor(hold.id);
    expect(outcome).toMatchObject({ status: 'confirmed', payment_status: 'succeeded', reason: null });
    expect(outcome.appointment.reference).toBe(appointment.reference);
    expect(appointment).toMatchObject({
      status: 'confirmed', therapist_id: A, customer_id: hold.customer_id, contact_name: 'Ngozi Example', contact_phone: '+2348011111111',
      customer_notes: 'Allergic to lavender', currency: 'NGN',
    });
    expect(Number(appointment.total_minor)).toBe(PRICE);
    expect(new Date(appointment.starts_at)).toEqual(new Date(hold.starts_at));
    expect((await holdRow(hold.id)).status).toBe('converted');
    expect(await payment(reference)).toMatchObject({
      status: 'succeeded', appointment_id: appointment.id, needs_refund: false, paid_currency: 'NGN', provider_transaction_id: 'TX-1', channel: 'card',
    });
    expect(Number((await payment(reference)).refundable_minor)).toBe(PRICE);
  });

  it('confirms a deposit payment against the full booking price', async () => {
    await db.query(`update business_settings set payment_mode = 'deposit', deposit_percent = 50`);
    const hold = await readyHold();
    const { reference } = await begin(hold);
    await db.query(`update business_settings set payment_mode = 'full'`);

    expect(await record(reference, 'success', { paid: 2_000_000 })).toMatchObject({ status: 'confirmed' });
    const [appointment] = await appointmentsFor(hold.id);
    expect(Number(appointment.total_minor)).toBe(PRICE);
    expect(await payment(reference)).toMatchObject({ kind: 'deposit', status: 'succeeded' });
    expect(Number((await payment(reference)).paid_minor)).toBe(2_000_000);
  });

  it('is idempotent: repeating the result changes nothing', async () => {
    const hold = await readyHold();
    const { reference } = await begin(hold);
    const first = await record(reference, 'success');
    const again = await record(reference, 'success');
    const contradicting = await record(reference, 'failed', { reason: 'late noise' });
    expect(again).toEqual(first);
    expect(contradicting).toEqual(first);
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
    expect((await payment(reference)).status).toBe('succeeded');
  });

  it('keeps the contact details typed for this booking without rewriting an existing customer', async () => {
    const existing = await one(db, `select * from customers where email = 'demo.bola@example.com'`);
    const hold = await readyHold({ email: 'DEMO.BOLA@example.com', name: 'Bola (new number)', phone: '+2349099999999' });
    expect(hold.customer_id).toBe(existing.id);
    const { reference } = await begin(hold);
    await record(reference, 'success');

    const [appointment] = await appointmentsFor(hold.id);
    expect(appointment).toMatchObject({ customer_id: existing.id, contact_name: 'Bola (new number)', contact_phone: '+2349099999999' });
    expect(await one(db, `select full_name, phone from customers where id = $1`, [existing.id])).toEqual({ full_name: existing.full_name, phone: existing.phone });
  });
});

describe('failed, pending and abandoned payments', () => {
  it('records a failure without booking, and leaves the hold usable', async () => {
    const hold = await readyHold();
    const { reference } = await begin(hold);
    expect(await record(reference, 'failed', { reason: 'Insufficient funds' })).toMatchObject({ status: 'failed', appointment: null });
    expect(await payment(reference)).toMatchObject({ status: 'failed', failure_reason: 'Insufficient funds', needs_refund: false, paid_minor: null });
    expect(await appointmentsFor(hold.id)).toEqual([]);
    expect((await holdRow(hold.id)).status).toBe('active');
  });

  it('lets the guest retry with a new reference; a late success on the old one is flagged, not double-booked', async () => {
    const hold = await readyHold();
    const first = await begin(hold);
    await record(first.reference, 'failed');
    const second = await begin(hold);
    expect(second.is_new).toBe(true);
    expect(second.reference).not.toBe(first.reference);

    expect(await record(second.reference, 'success')).toMatchObject({ status: 'confirmed' });
    expect(await record(first.reference, 'success')).toMatchObject({ status: 'refund_required', reason: 'duplicate_payment' });
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
    expect(await payment(first.reference)).toMatchObject({ status: 'succeeded', needs_refund: true, needs_refund_reason: 'duplicate_payment', appointment_id: null });
  });

  it('treats "not paid yet" as pending and never as a booking', async () => {
    const hold = await readyHold();
    const { reference } = await begin(hold);
    expect(await record(reference, 'pending')).toMatchObject({ status: 'pending', payment_status: 'pending', appointment: null });
    expect(await appointmentsFor(hold.id)).toEqual([]);
    expect((await begin(hold)).reference).toBe(reference); // still the one open payment
  });

  it('marks a payment abandoned after 30 minutes; the hold has long since expired on its own', async () => {
    const hold = await readyHold();
    const { reference, hold_expires_at } = await begin(hold);
    expect(minutesFromNow(hold_expires_at)).toBeLessThanOrEqual(15);

    await db.query(`update payments set created_at = now() - interval '29 minutes' where provider_reference = $1`, [reference]);
    await service(() => db.query(`select run_booking_maintenance()`));
    expect((await payment(reference)).status).toBe('initialized');

    await db.query(`update payments set created_at = now() - interval '31 minutes' where provider_reference = $1`, [reference]);
    await expire(hold.id);
    await service(() => db.query(`select run_booking_maintenance()`));
    expect((await payment(reference)).status).toBe('abandoned');
    expect((await holdRow(hold.id)).status).toBe('expired');
    expect(await appointmentsFor(hold.id)).toEqual([]);
  });

  it('still honours a genuine payment that arrives after it was marked abandoned, if the slot is free', async () => {
    const hold = await readyHold();
    const { reference } = await begin(hold);
    await db.query(`update payments set created_at = now() - interval '31 minutes' where provider_reference = $1`, [reference]);
    await expire(hold.id);
    await service(() => db.query(`select run_booking_maintenance()`));

    expect(await record(reference, 'success')).toMatchObject({ status: 'confirmed' });
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
    expect((await holdRow(hold.id)).status).toBe('converted');
  });
});

describe('amount and currency are checked against what the database expected', () => {
  it.each([
    ['less than expected', { paid: PRICE - 1 }, 'amount_mismatch'],
    ['more than expected', { paid: PRICE + 100 }, 'amount_mismatch'],
    ['a different currency', { currency: 'USD' }, 'currency_mismatch'],
  ])('refuses to book when the provider reports %s', async (_label, verdict, reason) => {
    const hold = await readyHold();
    const { reference } = await begin(hold);
    expect(await record(reference, 'success', verdict)).toMatchObject({ status: 'refund_required', reason, appointment: null });
    expect(await payment(reference)).toMatchObject({ status: 'succeeded', needs_refund: true, needs_refund_reason: reason, appointment_id: null });
    expect(await appointmentsFor(hold.id)).toEqual([]);
    expect((await holdRow(hold.id)).status).toBe('active'); // not consumed
  });
});

describe('payment arriving after the hold is no longer live', () => {
  it('books anyway when the hold expired but the slot is still free', async () => {
    const hold = await readyHold();
    const { reference } = await begin(hold);
    await expire(hold.id);
    expect(await record(reference, 'success')).toMatchObject({ status: 'confirmed' });
    expect(await appointmentsFor(hold.id)).toHaveLength(1);
  });

  it('flags slot_retaken when another guest now holds the slot, and leaves that guest untouched', async () => {
    const start = nextSlot();
    const hold = await readyHold({ start });
    const { reference } = await begin(hold);
    await expire(hold.id);
    const other = await readyHold({ start });

    expect(await record(reference, 'success')).toMatchObject({ status: 'refund_required', reason: 'slot_retaken', appointment: null });
    expect(await payment(reference)).toMatchObject({ status: 'succeeded', needs_refund: true, needs_refund_reason: 'slot_retaken' });
    expect(Number((await payment(reference)).refundable_minor)).toBe(PRICE);
    expect(await appointmentsFor(hold.id)).toEqual([]);
    expect((await holdRow(other.id)).status).toBe('active');

    // The other guest can still pay and book.
    const theirs = await begin(other);
    expect(await record(theirs.reference, 'success')).toMatchObject({ status: 'confirmed' });
  });

  it('flags slot_retaken when another appointment now has the slot (overlapping, not identical)', async () => {
    const start = nextSlot();
    const hold = await readyHold({ start });
    const { reference } = await begin(hold);
    await expire(hold.id);
    const other = await readyHold({ start: new Date(start.getTime() + 30 * 60_000) });
    await record((await begin(other)).reference, 'success');

    expect(await record(reference, 'success')).toMatchObject({ status: 'refund_required', reason: 'slot_retaken' });
    expect(await rows(db, `select id from appointments where therapist_id = $1 and starts_at = $2`, [A, start.toISOString()])).toEqual([]);
  });

  it('books a released hold if the slot is still free, and flags hold_released if it is not', async () => {
    const free = await readyHold();
    const freeRef = (await begin(free)).reference;
    await service(() => db.query(`select release_booking_hold($1)`, [free.hold_token]));
    expect(await record(freeRef, 'success')).toMatchObject({ status: 'confirmed' });

    const start = nextSlot();
    const taken = await readyHold({ start });
    const takenRef = (await begin(taken)).reference;
    await service(() => db.query(`select release_booking_hold($1)`, [taken.hold_token]));
    await readyHold({ start });
    expect(await record(takenRef, 'success')).toMatchObject({ status: 'refund_required', reason: 'hold_released' });
    expect(await appointmentsFor(taken.id)).toEqual([]);
  });

  it('does not book a slot whose start time has already passed', async () => {
    const hold = await readyHold();
    const { reference } = await begin(hold);
    await db.query(`update booking_holds set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour', blocked_until = now() - interval '45 minutes' where id = $1`, [hold.id]);
    expect(await record(reference, 'success')).toMatchObject({ status: 'refund_required', reason: 'slot_passed' });
  });

  it('a therapist other than the held one is never substituted', async () => {
    const start = nextSlot();
    const hold = await readyHold({ start });
    const { reference } = await begin(hold);
    await expire(hold.id);
    await readyHold({ start }); // A is taken again; B is free at this time
    await record(reference, 'success');
    expect(await rows(db, `select id from appointments where therapist_id = $1 and starts_at = $2`, [B, start.toISOString()])).toEqual([]);
  });
});

describe('invalid input to the state machine', () => {
  it('rejects unknown references and unknown statuses', async () => {
    expect(await reasonFor(record('SMMP-DOESNOTEXIST', 'success'))).toBe('payment_not_found');
    const { reference } = await begin(await readyHold());
    expect(await reasonFor(record(reference, 'paid'))).toBe('invalid_status');
    expect(await reasonFor(service(() => db.query(`select record_payment_result('paystack', $1, 'success')`, [reference])))).toBe('incomplete_result');
    expect((await payment(reference)).status).toBe('initialized');
  });
});

describe('refund lifecycle (recorded, never initiated)', () => {
  const refund = async (reference: string, status: string, refundRef: string | null = 'RF-1', amount: number | null = null, reason: string | null = null) =>
    (await service(() => one(db, `select record_refund_event('paystack', $1, $2, $3, $4, $5) as r`, [reference, status, refundRef, amount, reason]))).r;

  async function paidButUnbooked() {
    const start = nextSlot();
    const hold = await readyHold({ start });
    const { reference } = await begin(hold);
    await expire(hold.id);
    await readyHold({ start });
    await record(reference, 'success');
    return reference;
  }

  it('follows pending -> processing -> processed and closes the refund need', async () => {
    const reference = await paidButUnbooked();
    await refund(reference, 'pending', 'RF-A', PRICE, 'Slot was no longer available');
    expect(await payment(reference)).toMatchObject({ refund_status: 'pending', refund_reference: 'RF-A', refund_reason: 'Slot was no longer available', status: 'succeeded', needs_refund: true });
    expect((await payment(reference)).refund_requested_at).not.toBeNull();

    await refund(reference, 'processing', 'RF-A');
    expect((await payment(reference)).refund_status).toBe('processing');

    await refund(reference, 'processed', 'RF-A', PRICE);
    const done = await payment(reference);
    expect(done).toMatchObject({ refund_status: 'processed', status: 'refunded', needs_refund: false, refund_error: null });
    expect(Number(done.refunded_minor)).toBe(PRICE);
    expect(Number(done.refundable_minor)).toBe(0);
    expect(done.refund_processed_at).not.toBeNull();
  });

  it('does not count the same processed refund twice', async () => {
    const reference = await paidButUnbooked();
    await refund(reference, 'processed', 'RF-B', 1_000_000);
    await refund(reference, 'processed', 'RF-B', 1_000_000);
    const partial = await payment(reference);
    expect(partial).toMatchObject({ status: 'partially_refunded', needs_refund: true });
    expect(Number(partial.refunded_minor)).toBe(1_000_000);
    expect(Number(partial.refundable_minor)).toBe(PRICE - 1_000_000);

    await refund(reference, 'processed', 'RF-C', 5_000_000); // more than remains: capped at what was paid
    expect(Number((await payment(reference)).refunded_minor)).toBe(PRICE);
    expect((await payment(reference)).status).toBe('refunded');
  });

  it('records failed and needs-attention refunds with the error, keeping the refund need open', async () => {
    const reference = await paidButUnbooked();
    await refund(reference, 'failed', 'RF-D', PRICE, 'Account closed');
    expect(await payment(reference)).toMatchObject({ refund_status: 'failed', refund_error: 'Account closed', needs_refund: true, status: 'succeeded' });
    await refund(reference, 'needs-attention', 'RF-D');
    expect((await payment(reference)).refund_status).toBe('needs_attention');
  });

  it('rejects refund events for unknown or unpaid payments', async () => {
    expect(await reasonFor(refund('SMMP-NOPE', 'processed'))).toBe('payment_not_found');
    const { reference } = await begin(await readyHold());
    expect(await reasonFor(refund(reference, 'processed'))).toBe('payment_not_paid');
    expect(await reasonFor(refund(reference, 'reversed'))).toBe('invalid_status');
  });
});

describe('webhook delivery log', () => {
  it('reports a delivery as already handled only after it was finished', async () => {
    const log = async () => (await service(() => one(db, `select log_payment_event('paystack', 'charge.success:1', 'charge.success', '{"id": 1}') as seen`))).seen;
    expect(await log()).toBe(false);
    expect(await log()).toBe(false); // logged but not finished: must be processed again
    await service(() => db.query(`select finish_payment_event('paystack', 'charge.success:1', null, 'provider down')`));
    expect(await log()).toBe(false);
    await service(() => db.query(`select finish_payment_event('paystack', 'charge.success:1')`));
    expect(await log()).toBe(true);
    expect(await rows(db, `select id from payment_events where event_id = 'charge.success:1'`)).toHaveLength(1);
  });
});

describe('trust boundary', () => {
  it('no guest or signed-in user can call any payment function', async () => {
    const hold = await readyHold();
    const { reference } = await begin(hold);
    const calls = [
      `select begin_hold_payment('${hold.hold_token}', 'paystack', true)`,
      `select set_payment_checkout('paystack', '${reference}', 'https://evil.example')`,
      `select mark_payment_init_failed('paystack', '${reference}', 'x')`,
      `select get_payment_outcome('paystack', '${reference}')`,
      `select record_payment_result('paystack', '${reference}', 'success', ${PRICE}, 'NGN')`,
      `select record_refund_event('paystack', '${reference}', 'processed')`,
      `select log_payment_event('paystack', 'e', 't', '{}')`,
      `select finish_payment_event('paystack', 'e')`,
      `select private.payment_outcome(p) from payments p`,
    ];
    const owner = await createStaff(db, 'owner-pay@example.com', 'owner');
    for (const call of calls) {
      await expect(asRole(db, 'anon', null, () => db.query(call))).rejects.toThrow(/permission denied/);
      await expect(asRole(db, 'authenticated', null, () => db.query(call))).rejects.toThrow(/permission denied/);
      await expect(asRole(db, 'authenticated', owner, () => db.query(call))).rejects.toThrow(/permission denied/);
    }
    expect((await payment(reference)).status).toBe('initialized');
    expect(await appointmentsFor(hold.id)).toEqual([]);
  });

  it('guests and therapists cannot read payments; the owner can read but never write them', async () => {
    const owner = await createStaff(db, 'owner-read@example.com', 'owner');
    const therapist = await createStaff(db, 'therapist-read@example.com', 'therapist');
    await db.query(`update therapists set profile_id = $1 where id = $2`, [therapist, A]);

    await expect(asRole(db, 'anon', null, () => rows(db, `select * from payments`))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, 'anon', null, () => rows(db, `select * from payment_events`))).rejects.toThrow(/permission denied/);
    expect(await asRole(db, 'authenticated', therapist, () => rows(db, `select id from payments`))).toEqual([]);
    expect((await asRole(db, 'authenticated', owner, () => rows(db, `select id from payments`))).length).toBeGreaterThan(0);
    await expect(asRole(db, 'authenticated', owner, () => rows(db, `select * from payment_events`))).rejects.toThrow(/permission denied/);
    for (const write of [
      `update payments set status = 'succeeded'`,
      `update payments set needs_refund = false`,
      `delete from payments`,
      `insert into payments (provider, provider_reference, amount_minor, is_test) values ('paystack', 'forged', 100, false)`,
    ]) {
      await expect(asRole(db, 'authenticated', owner, () => db.query(write))).rejects.toThrow(/permission denied/);
    }
  });
});
