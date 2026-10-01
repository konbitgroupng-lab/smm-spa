import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createStaff, createTestDb, one, rows } from './harness';

let db: PGlite;
let ownerId: string;
let therapistAUser: string;
let therapistBUser: string;
let inactiveUser: string;
let therapistA: string;
let therapistB: string;
let adaId: string;
let bolaId: string;
let apptA: string;
let apptB: string;

beforeAll(async () => {
  db = await createTestDb();

  ownerId = await createStaff(db, 'owner@example.com', 'owner');
  therapistAUser = await createStaff(db, 'therapist-a@example.com', 'therapist');
  therapistBUser = await createStaff(db, 'therapist-b@example.com', 'therapist');
  inactiveUser = await createStaff(db, 'inactive@example.com', 'admin', { active: false });

  therapistA = (await one(db, `update therapists set profile_id = $1 where sort_order = 1 returning id`, [therapistAUser])).id;
  therapistB = (await one(db, `update therapists set profile_id = $1 where sort_order = 2 returning id`, [therapistBUser])).id;

  adaId = (await one(db, `select id from customers where email = 'demo.ada@example.com'`)).id;
  bolaId = (await one(db, `select id from customers where email = 'demo.bola@example.com'`)).id;

  // Seed gives therapist A an appointment with Ada; give therapist B one with Bola.
  apptA = (await one(db, `select id from appointments where therapist_id = $1`, [therapistA])).id;
  apptB = (
    await one(
      db,
      `insert into appointments (customer_id, service_id, therapist_id, starts_at, ends_at, blocked_until, status, price_minor, is_demo)
       select $1, s.id, $2, now() + interval '9 days', now() + interval '9 days 1 hour', now() + interval '9 days 75 minutes',
              'confirmed', s.price_minor, true
       from services s where s.slug = 'deep-tissue'
       returning id`,
      [bolaId, therapistB],
    )
  ).id;

  const question = await one(db, `select id from intake_questions where key = 'allergies'`);
  await db.query(`insert into appointment_intake_answers (appointment_id, question_id, answer) values ($1, $3, 'A'), ($2, $3, 'B')`, [
    apptA,
    apptB,
    question.id,
  ]);
  await db.query(
    `insert into payments (appointment_id, provider, provider_reference, amount_minor, is_test, status, is_demo)
     values ($1, 'paystack', 'demo-ref-1', 4000000, true, 'succeeded', true)`,
    [apptA],
  );
});

describe('database connection and schema', () => {
  it('applies every migration and the demo seed', async () => {
    const tables = await rows(db, `select table_name from information_schema.tables where table_schema = 'public'`);
    expect(tables.map((t) => t.table_name).sort()).toEqual(
      [
        'announcements', 'appointment_intake_answers', 'appointments', 'blackout_dates', 'booking_holds',
        'business_hours', 'business_settings', 'customers', 'dispatch_zones', 'faqs', 'gallery_items',
        'intake_questions', 'media_assets', 'payment_events', 'payments', 'profiles', 'service_package_items',
        'services', 'site_content', 'testimonials', 'therapist_breaks', 'therapist_schedules',
        'therapist_services', 'therapist_time_off', 'therapists',
      ].sort(),
    );
  });

  it('has row level security enabled on every public table', async () => {
    const unprotected = await rows(
      db,
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(unprotected).toEqual([]);
  });

  it('creates the site-media storage bucket as public with image-only uploads', async () => {
    const bucket = await one(db, `select * from storage.buckets where id = 'site-media'`);
    expect(bucket.public).toBe(true);
    expect(bucket.allowed_mime_types).toContain('image/webp');
  });
});

describe('authentication foundation', () => {
  it('creates an inactive, lowest-privilege profile for every new auth user', async () => {
    const { id } = await one(
      db,
      `insert into auth.users (email, raw_user_meta_data) values ('new@example.com', '{"full_name": "New Person", "role": "owner"}') returning id`,
    );
    const profile = await one(db, `select * from profiles where id = $1`, [id]);
    expect(profile.role).toBe('therapist'); // role in sign-up metadata is ignored
    expect(profile.is_active).toBe(false);
    expect(profile.full_name).toBe('New Person');
  });

  it('resolves roles only for active staff', async () => {
    const check = () => one(db, `select private.is_admin() as is_admin, private.staff_role() as role, private.therapist_id() as therapist_id`);
    expect(await asRole(db, 'authenticated', ownerId, check)).toMatchObject({ is_admin: true, role: 'owner', therapist_id: null });
    expect(await asRole(db, 'authenticated', therapistAUser, check)).toMatchObject({ is_admin: false, role: 'therapist', therapist_id: therapistA });
    expect(await asRole(db, 'authenticated', inactiveUser, check)).toMatchObject({ is_admin: false, role: null });
    expect(await asRole(db, 'anon', null, check)).toMatchObject({ is_admin: false, role: null, therapist_id: null });
  });
});

describe('RLS: guests', () => {
  it('can read active services and published content', async () => {
    await db.query(`update services set is_active = false where slug = 'thai-massage'`);
    const services = await asRole(db, 'anon', null, () => rows(db, `select slug from services`));
    expect(services).toHaveLength(8);
    expect(services.map((s) => s.slug)).not.toContain('thai-massage');

    const faqs = await asRole(db, 'anon', null, () => rows(db, `select id from faqs`));
    expect(faqs.length).toBeGreaterThan(0);
    await db.query(`update services set is_active = true where slug = 'thai-massage'`);
  });

  it('cannot see disabled intake questions or unpublished testimonials', async () => {
    await db.query(`update testimonials set is_published = false where author_name = '[DEMO] Guest B'`);
    const result = await asRole(db, 'anon', null, async () => ({
      questions: await rows(db, `select id from intake_questions`),
      testimonials: await rows(db, `select id from testimonials`),
    }));
    expect(result.questions).toEqual([]);
    expect(result.testimonials).toHaveLength(1);
  });

  it.each([
    'customers', 'appointments', 'booking_holds', 'payments', 'payment_events', 'profiles',
    'appointment_intake_answers', 'therapist_schedules', 'therapist_time_off', 'blackout_dates',
  ])('cannot read %s', async (table) => {
    await expect(asRole(db, 'anon', null, () => rows(db, `select * from ${table}`))).rejects.toThrow(/permission denied/);
  });

  it('cannot write to the catalogue', async () => {
    await expect(
      asRole(db, 'anon', null, () => db.query(`update services set price_minor = 1`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('RLS: therapists', () => {
  it('see only their own appointments, customers and intake answers', async () => {
    const seen = await asRole(db, 'authenticated', therapistAUser, async () => ({
      appointments: await rows(db, `select id from appointments`),
      customers: await rows(db, `select id from customers`),
      answers: await rows(db, `select answer from appointment_intake_answers`),
      schedules: await rows(db, `select distinct therapist_id from therapist_schedules`),
    }));
    expect(seen.appointments.map((a) => a.id)).toEqual([apptA]);
    expect(seen.customers.map((c) => c.id)).toEqual([adaId]);
    expect(seen.answers).toEqual([{ answer: 'A' }]);
    expect(seen.schedules).toEqual([{ therapist_id: therapistA }]);
  });

  it('cannot see payments, holds or other staff profiles', async () => {
    const seen = await asRole(db, 'authenticated', therapistAUser, async () => ({
      payments: await rows(db, `select id from payments`),
      holds: await rows(db, `select id from booking_holds`),
      profiles: await rows(db, `select id from profiles`),
    }));
    expect(seen.payments).toEqual([]);
    expect(seen.holds).toEqual([]);
    expect(seen.profiles.map((p) => p.id)).toEqual([therapistAUser]);
  });

  it('cannot change appointments, prices or their own role', async () => {
    const changed = await asRole(db, 'authenticated', therapistAUser, async () => ({
      appointments: (await db.query(`update appointments set status = 'cancelled'`)).affectedRows,
      services: (await db.query(`update services set price_minor = 1`)).affectedRows,
      profiles: (await db.query(`update profiles set role = 'owner'`)).affectedRows,
    }));
    expect(changed).toEqual({ appointments: 0, services: 0, profiles: 0 });
    await expect(
      asRole(db, 'authenticated', therapistAUser, () =>
        db.query(`insert into customers (full_name, email) values ('X', 'x@example.com')`),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('RLS: inactive staff', () => {
  it('have no staff access even with an admin role on file', async () => {
    const seen = await asRole(db, 'authenticated', inactiveUser, async () => ({
      appointments: await rows(db, `select id from appointments`),
      customers: await rows(db, `select id from customers`),
    }));
    expect(seen).toEqual({ appointments: [], customers: [] });
  });
});

describe('RLS: owner/admin', () => {
  it('sees all appointments, customers and payments', async () => {
    const seen = await asRole(db, 'authenticated', ownerId, async () => ({
      appointments: await rows(db, `select id from appointments`),
      customers: await rows(db, `select id from customers`),
      payments: await rows(db, `select id from payments`),
    }));
    expect(seen.appointments).toHaveLength(2);
    expect(seen.customers).toHaveLength(2);
    expect(seen.payments).toHaveLength(1);
  });

  it('can create a customer and an appointment', async () => {
    const appointment = await asRole(db, 'authenticated', ownerId, async () => {
      const customer = await one(
        db,
        `insert into customers (full_name, email, phone, is_demo) values ('[DEMO] Chidi Example', 'demo.chidi@example.com', '+2340000000003', true) returning id`,
      );
      return one(
        db,
        `insert into appointments (customer_id, service_id, therapist_id, starts_at, ends_at, blocked_until, status, price_minor, dispatch_fee_minor, is_demo)
         select $1, s.id, $2, now() + interval '12 days', now() + interval '12 days 1 hour', now() + interval '12 days 75 minutes',
                'confirmed', s.price_minor, 300000, true
         from services s where s.slug = 'hot-stone'
         returning reference, total_minor`,
        [customer.id, therapistA],
      );
    });
    expect(appointment.reference).toMatch(/^SMM-[0-9A-F]{8}$/);
    expect(Number(appointment.total_minor)).toBe(5300000);
  });

  it('rejects a second customer with the same email in a different case', async () => {
    await expect(
      asRole(db, 'authenticated', ownerId, () =>
        db.query(`insert into customers (full_name, email) values ('Dup', 'DEMO.ADA@example.com')`),
      ),
    ).rejects.toThrow(/customers_email_key/);
  });

  it('cannot fabricate payment records', async () => {
    await expect(
      asRole(db, 'authenticated', ownerId, () =>
        db.query(
          `insert into payments (appointment_id, provider, provider_reference, amount_minor, is_test, status)
           values ($1, 'paystack', 'forged', 100, false, 'succeeded')`,
          [apptA],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('can manage site media in storage; therapists cannot', async () => {
    const upload = () => db.query(`insert into storage.objects (bucket_id, name) values ('site-media', 'gallery/' || gen_random_uuid() || '.webp')`);
    await expect(asRole(db, 'authenticated', ownerId, upload)).resolves.toBeDefined();
    await expect(asRole(db, 'authenticated', therapistAUser, upload)).rejects.toThrow(/row-level security/);
    await expect(asRole(db, 'anon', null, upload)).rejects.toThrow(/row-level security/);
  });
});
