import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { asRole, createStaff, createTestDb, one, rows } from './harness';
import { at, upcoming } from './dates';

// Phase 6f: supabase/snippets/purge_demo_data.sql, the pre-launch clean-up.
// It removes demo bookings (including test bookings paid with demo payments)
// and demo staff, keeps everything real, and refuses to leave no owner.

const PURGE = readFileSync(path.resolve(__dirname, '../../supabase/snippets/purge_demo_data.sql'), 'utf8');
const LOAD_CONTENT = readFileSync(path.resolve(__dirname, '../../supabase/snippets/load_site_content.sql'), 'utf8');
const service = <T>(db: PGlite, fn: () => Promise<T>) => asRole(db, 'service_role', null, fn);
const count = async (db: PGlite, sql: string, params: unknown[] = []) => (await one(db, `select count(*)::int as n from ${sql}`, params)).n;

let slot = 0;
/** A booking paid through the given provider ('mock' = demo payment, as on the development site). */
async function paidBooking(db: PGlite, provider: 'mock' | 'paystack', email: string) {
  const swedish = (await one(db, `select id, price_minor from services where slug = 'swedish'`));
  const therapist = (await one(db, `select id from therapists where sort_order = 1`)).id;
  const start = at(upcoming(1 + (slot % 5), 1 + Math.floor(slot / 5)), '10:00');
  slot++;
  const hold = await service(db, () => one(db, `select * from request_booking_hold($1, $2, $3)`, [swedish.id, start.toISOString(), therapist]));
  await service(db, () => one(db, `select * from attach_customer_to_hold($1, 'Guest', $2, '+2348000000000')`, [hold.hold_token, email]));
  const reference = (await service(db, () => one(db, `select begin_hold_payment($1, $2, true) as r`, [hold.hold_token, provider]))).r.reference;
  await service(db, () => one(db, `select record_payment_result($1, $2, 'success', $3, 'NGN', now(), 'TX', 'card') as r`, [provider, reference, Number(swedish.price_minor)]));
  return one(db, `select a.id, a.customer_id, a.is_demo from appointments a join payments p on p.appointment_id = a.id where p.provider_reference = $1`, [reference]);
}

async function demoOwner(db: PGlite) {
  const id = await createStaff(db, 'demo.owner@example.com', 'owner');
  await db.query(`update profiles set is_demo = true where id = $1`, [id]);
  return id;
}

describe('removing demo data before launch', () => {
  it('refuses while the demo owner is the only owner', async () => {
    const db = await createTestDb();
    await demoOwner(db);
    await expect(db.exec(PURGE)).rejects.toThrow(/No real owner yet/);
    expect(await count(db, `appointments where is_demo`)).toBeGreaterThan(0);
    await db.close();
  });

  it('removes demo and test bookings, their payments, test customers and demo staff; keeps real ones and the catalogue', async () => {
    const db = await createTestDb();
    const demo = await demoOwner(db);
    await createStaff(db, 'real.owner@example.com', 'owner');
    const test = await paidBooking(db, 'mock', 'tester@example.com');
    const real = await paidBooking(db, 'paystack', 'real.guest@example.com');
    expect(test.is_demo).toBe(true); // demo payments create demo bookings
    expect(real.is_demo).toBe(false);
    const servicesBefore = await count(db, `services`);

    await db.exec(PURGE);

    expect(await count(db, `appointments where is_demo`)).toBe(0);
    expect(await count(db, `payments where is_demo`)).toBe(0);
    expect(await count(db, `payment_events e join payments p on p.id = e.payment_id where p.is_demo`)).toBe(0);
    expect(await count(db, `customers where is_demo or id = $1`, [test.customer_id])).toBe(0);
    expect(await count(db, `profiles where id = $1`, [demo])).toBe(0);
    expect(await count(db, `auth.users where id = $1`, [demo])).toBe(0);
    expect(await count(db, `testimonials where is_demo`)).toBe(0);

    // Real data untouched; the catalogue kept and marked real.
    expect(await count(db, `appointments where id = $1`, [real.id])).toBe(1);
    expect(await count(db, `customers where id = $1`, [real.customer_id])).toBe(1);
    expect(await count(db, `payments where appointment_id = $1 and status = 'succeeded'`, [real.id])).toBe(1);
    expect(await count(db, `profiles where role = 'owner' and is_active`)).toBe(1);
    expect(await count(db, `services`)).toBe(servicesBefore);
    expect(await count(db, `services where is_demo`) + await count(db, `therapists where is_demo`) + await count(db, `dispatch_zones where is_demo`)).toBe(0);

    // Guests can still book.
    expect((await paidBooking(db, 'paystack', 'after@example.com')).is_demo).toBe(false);
    // Running it again changes nothing more.
    await db.exec(PURGE);
    expect(await count(db, `appointments where id = $1`, [real.id])).toBe(1);
    await db.close();
  });

  it('with the catalogue switch off, deletes the demo catalogue (once the real one has been entered)', async () => {
    const db = await createTestDb();
    await createStaff(db, 'real.owner@example.com', 'owner');
    await db.exec(PURGE.replace('KEEP_CATALOGUE constant boolean := true', 'KEEP_CATALOGUE constant boolean := false'));
    expect(await count(db, `services where is_demo`)).toBe(0);
    expect(await count(db, `therapists where is_demo`)).toBe(0);
    expect(await count(db, `dispatch_zones where is_demo`)).toBe(0);
    expect(await rows(db, `select key from site_content where is_demo`)).toEqual([]);
    await db.close();
  });

  it("afterwards, the website's own content loads as real, editable content, once", async () => {
    const db = await createTestDb();
    await createStaff(db, 'real.owner@example.com', 'owner');
    await db.exec(PURGE);
    expect(await count(db, `faqs`)).toBe(0); // the demo FAQs are gone
    await db.exec(LOAD_CONTENT);
    await db.exec(LOAD_CONTENT); // a second run adds nothing
    expect(await count(db, `faqs where is_published and not is_demo`)).toBe(7);
    expect(await count(db, `gallery_items where is_published and not is_demo`)).toBe(5);
    // The spa's six Google reviews, word for word, each labelled as a Google review.
    const reviews = await rows(db, `select author_name, author_location, body, rating from testimonials where is_published and not is_demo order by sort_order`);
    expect(reviews.map((r) => r.author_name)).toEqual(['Sikiru O.', 'David A.', 'Praizethompson', 'Feyisayo S.', 'Ezenagu E.', 'Emmanuel I.']);
    expect(reviews.every((r) => r.author_location === 'Google review' && r.rating === 5)).toBe(true);
    expect(reviews[1].body).toBe("I've had massage sessions a couple of times but this is the best so far.\n\nShe's jovial and super considerate, and always out to give the best experience.\n\nThank you✨");
    expect((await one(db, `select value->>'whatsapp' as w, is_published from site_content where key = 'contact'`))).toEqual({ w: '+234 811 859 9365', is_published: true });
    // The same text as the website's built-in questions.
    const { faqsData } = await import('../../src/data');
    const loaded = await rows(db, `select question from faqs order by sort_order`);
    expect(loaded.map((f) => f.question)).toEqual(faqsData.map((f) => f.question));
    await db.close();
  });
});
