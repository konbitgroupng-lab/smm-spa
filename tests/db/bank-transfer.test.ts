import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createStaff, createTestDb, one, rows } from './harness';
import { at, upcoming } from './dates';

// Guest bookings paid by direct bank transfer: a live reservation becomes a
// booking awaiting payment, the owner or an admin confirms the transfer, and
// an unconfirmed one lapses. Swedish massage is ₦40,000 (4,000,000 kobo).

let db: PGlite;
let swedish: string;
let A: string;
let zone: string;
let owner: string;
let admin: string;
let therapist: string;

let slotIndex = 0;
const TIMES = ['09:00', '11:00', '14:00', '16:00', '18:00'];
function nextSlot(): Date {
  const i = slotIndex++;
  return at(upcoming(1 + (Math.floor(i / TIMES.length) % 6), 1 + Math.floor(i / (TIMES.length * 6))), TIMES[i % TIMES.length]);
}

const service = <T>(fn: () => Promise<T>) => asRole(db, 'service_role', null, fn);
const as = <T>(user: string, fn: () => Promise<T>) => asRole(db, 'authenticated', user, fn);

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err: any) {
    return err.message;
  }
  throw new Error('expected a failure');
}

let guest = 0;
async function readyHold({ start = nextSlot(), email = `transfer${++guest}@example.com`, mobile = false } = {}) {
  const hold = await service(() => one(db, `select * from request_booking_hold($1, $2, $3, $4, $5)`, [
    swedish, start.toISOString(), A, mobile ? 'mobile' : 'sanctuary', mobile ? zone : null,
  ]));
  await service(() => one(db, `select * from attach_customer_to_hold($1, 'Transfer Guest', $2, '+2348000000000')`, [hold.hold_token, email]));
  return hold;
}
const requestTransfer = async (holdToken: string, address: string | null = null) =>
  (await service(() => one(db, `select request_transfer_booking($1, $2, 'Quiet room please') as r`, [holdToken, address]))).r;
const appointment = (token: string) => one(db, `select * from appointments where transfer_token = $1`, [token]);
const guestView = async (token: string) => (await service(() => one(db, `select get_transfer_booking($1) as r`, [token]))).r;

beforeAll(async () => {
  db = await createTestDb();
  swedish = (await one(db, `select id from services where slug = 'swedish'`)).id;
  A = (await one(db, `select id from therapists where sort_order = 1`)).id;
  zone = (await one(db, `select id from dispatch_zones where key = 'vi'`)).id;
  owner = await createStaff(db, 'owner@example.com', 'owner');
  admin = await createStaff(db, 'admin@example.com', 'admin');
  therapist = await createStaff(db, 'therapist@example.com', 'therapist');
});

describe('a guest chooses to pay by bank transfer', () => {
  it('the reservation becomes a booking awaiting payment, for the server-worked amount, with the bank details', async () => {
    const start = nextSlot();
    const hold = await readyHold({ start });
    const view = await requestTransfer(hold.hold_token);

    expect(view).toMatchObject({
      status: 'awaiting', expired: false, amount_minor: 4_000_000, booking_total_minor: 4_000_000, currency: 'NGN',
      bank: { name: 'Standard Chartered Bank', account_number: '0013819712', account_name: 'Sweet Mobile Massage and Spa Limited' },
    });
    expect(view.reference).toMatch(/^SMM-/);
    const minutesLeft = (new Date(view.due_at).getTime() - Date.now()) / 60_000;
    expect(minutesLeft).toBeGreaterThan(115);
    expect(minutesLeft).toBeLessThanOrEqual(120);

    const appt = await appointment(view.token);
    expect(appt).toMatchObject({ status: 'pending_payment', settlement: 'bank_transfer', source: 'online', customer_notes: 'Quiet room please', is_demo: false });
    expect((await one(db, `select status from booking_holds where id = $1`, [hold.id])).status).toBe('converted');
    // No provider payment exists for it.
    expect(await rows(db, `select id from payments where hold_id = $1`, [hold.id])).toEqual([]);

    // The time is taken for everyone else.
    expect(await failure(service(() => db.query(`select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), A])))).toBe('slot_unavailable');
    // The guest's page reads the same booking; a wrong token finds nothing.
    expect(await guestView(view.token)).toMatchObject({ status: 'awaiting', reference: view.reference });
    expect(await guestView('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('in-home: the travel fee is included and the address required; deposit mode asks for the deposit', async () => {
    const hold = await readyHold({ mobile: true });
    expect(await failure(requestTransfer(hold.hold_token))).toBe('address_required');
    const view = await requestTransfer(hold.hold_token, '12 Adeola Odeku Street, VI');
    expect(view).toMatchObject({ amount_minor: 4_800_000, booking_total_minor: 4_800_000 });

    await db.query(`update business_settings set payment_mode = 'deposit', deposit_percent = 40`);
    const deposit = await requestTransfer((await readyHold()).hold_token);
    expect(deposit).toMatchObject({ amount_minor: 1_600_000, booking_total_minor: 4_000_000 });
    await db.query(`update business_settings set payment_mode = 'full', deposit_percent = 50`);
  });

  it('is refused when switched off, for an expired reservation, too close to the start, or past the unpaid limit', async () => {
    await db.query(`update business_settings set transfer_enabled = false`);
    expect(await failure(requestTransfer((await readyHold()).hold_token))).toBe('transfers_disabled');
    await db.query(`update business_settings set transfer_enabled = true`);

    const lapsed = await readyHold();
    await db.query(`update booking_holds set expires_at = now() - interval '1 second' where id = $1`, [lapsed.id]);
    expect(await failure(requestTransfer(lapsed.hold_token))).toBe('hold_expired');

    // A reservation starting in 30 minutes leaves no time to transfer and check.
    const soon = await readyHold();
    await db.query(`update booking_holds set starts_at = now() + interval '30 minutes', ends_at = now() + interval '90 minutes',
                      blocked_until = now() + interval '105 minutes' where id = $1`, [soon.id]);
    expect(await failure(requestTransfer(soon.hold_token))).toBe('transfer_too_late');

    const email = 'repeat@example.com';
    await requestTransfer((await readyHold({ email })).hold_token);
    await requestTransfer((await readyHold({ email })).hold_token);
    expect(await failure(requestTransfer((await readyHold({ email })).hold_token))).toBe('transfer_limit');
  });

  it('a later online payment for the same reservation is flagged for refund, never a second booking', async () => {
    const hold = await readyHold();
    const reference = (await service(() => one(db, `select begin_hold_payment($1, 'paystack', true) as r`, [hold.hold_token]))).r.reference;
    const view = await requestTransfer(hold.hold_token);
    const outcome = (await service(() => one(db, `select record_payment_result('paystack', $1, 'success', 4000000, 'NGN', now(), 'TX', 'card') as r`, [reference]))).r;
    expect(outcome.status).toBe('refund_required');
    expect((await one(db, `select needs_refund_reason from payments where provider_reference = $1`, [reference])).needs_refund_reason).toBe('duplicate_payment');
    expect((await rows(db, `select id from appointments where hold_id = $1`, [hold.id])).length).toBe(1);
    // And no provider payment can be attached to the transfer booking.
    const appt = await appointment(view.token);
    expect(await failure(db.query(`update payments set appointment_id = $1 where provider_reference = $2`, [appt.id, reference]))).toBe('ledger_separation');
  });
});

describe('staff confirm the transfer', () => {
  it('owner or admin: listed, then confirmed with the version; the guest page then shows confirmed', async () => {
    const view = await requestTransfer((await readyHold()).hold_token);
    const listed = (await as(admin, () => one(db, `select staff_transfers() as r`))).r;
    const item = listed.find((t: any) => t.reference === view.reference);
    expect(item).toMatchObject({ amount_minor: 4_000_000, contact_name: 'Transfer Guest', service_name: 'Swedish Massage' });

    const stale = '2000-01-01 00:00:00+00';
    expect(await failure(as(admin, () => db.query(`select staff_confirm_transfer($1, $2)`, [item.appointment_id, stale])))).toBe('stale_record');
    await as(admin, () => db.query(`select staff_confirm_transfer($1, $2, 'Seen in the bank app')`, [item.appointment_id, item.updated_at]));

    const appt = await appointment(view.token);
    expect(appt.status).toBe('confirmed');
    expect(appt.transfer_received_by).toBe(admin);
    expect((await one(db, `select private.payment_state(a) as s from appointments a where a.id = $1`, [appt.id])).s).toBe('paid_transfer');
    expect(await guestView(view.token)).toMatchObject({ status: 'confirmed', bank: null });
    const log = await one(db, `select action, reason, changes from audit_log where entity_id = $1 and action = 'appointment.transfer_received'`, [appt.id]);
    expect(log.reason).toBe('Seen in the bank app');
    // Confirming twice is refused.
    expect(await failure(as(owner, () => db.query(`select staff_confirm_transfer($1, $2)`, [appt.id, appt.updated_at])))).toBe('invalid_status');
  });

  it('therapists and guests cannot list or confirm transfers', async () => {
    const view = await requestTransfer((await readyHold()).hold_token);
    const appt = await appointment(view.token);
    expect(await failure(as(therapist, () => db.query(`select staff_transfers()`)))).toBe('not_authorized');
    expect(await failure(as(therapist, () => db.query(`select staff_confirm_transfer($1, $2)`, [appt.id, appt.updated_at])))).toBe('not_authorized');
    expect(await failure(asRole(db, 'anon', null, () => db.query(`select staff_transfers()`)))).toMatch(/permission denied/);
    expect(await failure(asRole(db, 'anon', null, () => db.query(`select get_transfer_booking($1)`, [view.token])))).toMatch(/permission denied/);
    expect(await failure(asRole(db, 'authenticated', admin, () => db.query(`select request_transfer_booking($1)`, [view.token])))).toMatch(/permission denied/);
  });

  it('settlement changes cannot turn a transfer booking into another kind, or the reverse', async () => {
    const view = await requestTransfer((await readyHold()).hold_token);
    const appt = await appointment(view.token);
    expect(await failure(as(admin, () => db.query(`select staff_set_settlement($1, 'paid_offline', 'Paid cash', $2)`, [appt.id, appt.updated_at])))).toBe('invalid_source');
  });
});

describe('an unconfirmed transfer lapses', () => {
  it('maintenance cancels it after its deadline, frees the time, and the guest page says it expired', async () => {
    const start = nextSlot();
    const view = await requestTransfer((await readyHold({ start })).hold_token);
    const appt = await appointment(view.token);
    await db.query(`update appointments set transfer_due_at = now() - interval '1 second' where id = $1`, [appt.id]);
    await service(() => db.query(`select run_booking_maintenance()`));

    const after = await appointment(view.token);
    expect(after).toMatchObject({ status: 'cancelled', cancellation_reason: 'Bank transfer not confirmed in time', cancelled_by: null });
    expect(await guestView(view.token)).toMatchObject({ status: 'cancelled', expired: true, bank: null });
    expect((await one(db, `select private.payment_state(a) as s from appointments a where a.id = $1`, [appt.id])).s).toBe('unpaid');
    expect((await one(db, `select action, actor_kind from audit_log where entity_id = $1 and action = 'appointment.transfer_expired'`, [appt.id])).actor_kind).toBe('system');
    // Too late to confirm now; the time can be booked again.
    expect(await failure(as(owner, () => db.query(`select staff_confirm_transfer($1, $2)`, [after.id, after.updated_at])))).toBe('invalid_status');
    const again = await service(() => one(db, `select * from request_booking_hold($1, $2, $3)`, [swedish, start.toISOString(), A]));
    expect(again.status).toBe('active');
  });

  it('a booking still within its deadline is left alone', async () => {
    const view = await requestTransfer((await readyHold()).hold_token);
    await service(() => db.query(`select run_booking_maintenance()`));
    expect((await appointment(view.token)).status).toBe('pending_payment');
  });
});

describe('the owner sets the account', () => {
  it('owner only, with a reason and the current version; account number digits only; enabling needs all three details', async () => {
    const settings = await one(db, `select updated_at from business_settings`);
    expect(await failure(as(admin, () => db.query(`select owner_update_transfer_settings($1, 'x reason', true, 'GTBank', '0123456789', 'SMM Ltd')`, [settings.updated_at])))).toBe('not_authorized');
    expect(await failure(as(owner, () => db.query(`select owner_update_transfer_settings($1, 'New bank', true, 'GTBank', '0123-456', 'SMM Ltd')`, [settings.updated_at])))).toBe('invalid_transfer_settings');
    expect(await failure(as(owner, () => db.query(`select owner_update_transfer_settings($1, 'New bank', true, 'GTBank', null, 'SMM Ltd')`, [settings.updated_at])))).toBe('invalid_transfer_settings');
    await as(owner, () => db.query(`select owner_update_transfer_settings($1, 'New bank', true, 'GTBank', '0123 456 789', 'SMM Ltd')`, [settings.updated_at]));
    expect(await one(db, `select bank_name, bank_account_number, bank_account_name, transfer_enabled from business_settings`))
      .toEqual({ bank_name: 'GTBank', bank_account_number: '0123456789', bank_account_name: 'SMM Ltd', transfer_enabled: true });
    expect(await failure(as(owner, () => db.query(`select owner_update_transfer_settings($1, 'Again', false, null, null, null)`, [settings.updated_at])))).toBe('stale_record');
    expect((await as(admin, () => one(db, `select staff_settings() as r`))).r).toMatchObject({ transfer_enabled: true, bank_name: 'GTBank', transfer_hold_minutes: 120 });
  });
});
