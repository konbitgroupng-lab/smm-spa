import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createStaff, createTestDb, one, rows } from './harness';

// Phase 6a: the staff functions for website content, against every kind of
// caller, with their validation, version checks, publishing rules and audit.

let db: PGlite;
const id: Record<string, string> = {};

type Actor = 'guest' | 'newAccount' | 'inactiveAdmin' | 'therapist' | 'admin' | 'owner';
const REFUSED: Actor[] = ['newAccount', 'inactiveAdmin', 'therapist'];
const as = <T>(actor: Actor, fn: () => Promise<T>) =>
  actor === 'guest' ? asRole(db, 'anon', null, fn) : asRole(db, 'authenticated', id[actor], fn);
/** Calls a staff function and returns its (single) result. */
const call = async <T = any>(actor: Actor, sql: string, params: unknown[] = []): Promise<T> =>
  as(actor, async () => (await db.query<any>(`select ${sql} as r`, params)).rows[0].r);
const outcome = async (actor: Actor, sql: string, params: unknown[] = []): Promise<string> => {
  try {
    await call(actor, sql, params);
    return 'ok';
  } catch (err: any) {
    return /permission denied/.test(err.message) ? 'denied' : err.message;
  }
};
const j = (value: unknown) => JSON.stringify(value);
// Versions travel as text, as they do in the staff app (a JS Date drops microseconds).
const version = async (table: string, rowId: string, key = 'id') =>
  (await one(db, `select updated_at::text as v from ${table} where ${key} = $1`, [rowId])).v as string;
const lastAudit = (entity: string, entityId: string) =>
  one(db, `select actor_id, actor_role, actor_kind, action, reason, changes from audit_log where entity_type = $1 and entity_id = $2 order by id desc limit 1`, [entity, entityId]);
const auditCount = async () => Number((await one(db, `select count(*) from audit_log`)).count);

const FAQ = { question: 'Do you offer couples sessions?', answer: ['Yes, in our sanctuary.', 'Please book both places.'] };
const TESTIMONIAL = { author_name: 'Verified Guest', author_location: 'Lagos', body: 'A calm and careful session.', rating: 5 };
const ANNOUNCEMENT = { kind: 'promotion', title: 'Weekday mornings', body: 'Quieter hours.' };
const CONTACT = { address: '1 Example Close, Lagos', phone: '+234 800 000 0000', email: 'hello@example.com', whatsapp: null };

async function storedFile(folder = 'gallery', ext = 'webp'): Promise<string> {
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  await db.query(`insert into storage.objects (bucket_id, name) values ('site-media', $1)`, [path]);
  return path;
}
async function media(actor: Actor = 'admin'): Promise<{ id: string; path: string; updated_at: string }> {
  const path = await storedFile();
  const m = await call(actor, `staff_register_media($1, 2048, 800, 600, 'A quiet room')`, [path]);
  return { id: m.id, path, updated_at: await version('media_assets', m.id) };
}

beforeAll(async () => {
  db = await createTestDb();
  id.owner = await createStaff(db, 'owner@example.com', 'owner');
  id.admin = await createStaff(db, 'admin@example.com', 'admin');
  id.therapist = await createStaff(db, 'therapist@example.com', 'therapist');
  id.inactiveAdmin = await createStaff(db, 'gone@example.com', 'admin', { active: false });
  id.newAccount = (await one(db, `insert into auth.users (email) values ('new@example.com') returning id`)).id;
});

describe('who may call the content functions', () => {
  it('guests are refused by the grants; accounts without owner/admin access by the functions, before anything else is checked', async () => {
    const faq = await one(db, `select id, updated_at::text as v from faqs order by sort_order limit 1`);
    const calls: [string, unknown[]][] = [
      [`staff_content()`, []],
      [`staff_save_faq(null, null, $1)`, [j(FAQ)]],
      [`staff_save_faq($1, $2, $3)`, [faq.id, faq.v, j(FAQ)]],
      [`staff_save_testimonial(null, null, $1)`, [j(TESTIMONIAL)]],
      [`staff_save_gallery_item(null, null, $1)`, [j({ title: 'Room', image_url: '/assets/images/room.jpg' })]],
      [`staff_save_announcement(null, null, $1)`, [j(ANNOUNCEMENT)]],
      [`staff_save_site_content('contact', null, $1)`, [j(CONTACT)]],
      [`staff_set_content_published('faq', $1, false, $2)`, [faq.id, faq.v]],
      [`staff_reorder_content('faq', $1)`, [[faq.id]]],
      [`staff_delete_content('faq', $1, 'No longer offered', $2)`, [faq.id, faq.v]],
      [`staff_delete_content('faq', $1, null, $2)`, [faq.id, faq.v]], // role is checked before the reason
      [`staff_register_media('gallery/x.png', 10)`, []],
      [`staff_update_media($1, now(), 'x')`, [faq.id]],
      [`staff_remove_media($1, 'unused', now())`, [faq.id]],
      [`staff_remove_media($1, null, now())`, [faq.id]],
    ];
    const before = await auditCount();
    for (const [sql, params] of calls) {
      expect(await outcome('guest', sql, params), `guest: ${sql}`).toBe('denied');
      for (const actor of REFUSED) {
        expect(await outcome(actor, sql, params), `${actor}: ${sql}`).toBe('not_authorized');
      }
    }
    expect(await auditCount()).toBe(before);
    expect(await one(db, `select question from faqs where id = $1`, [faq.id])).not.toEqual({ question: FAQ.question });
  });

  it('owner and admin read everything, including drafts and management details', async () => {
    await db.query(`update faqs set is_published = false where sort_order = 2`);
    for (const actor of ['owner', 'admin'] as Actor[]) {
      const content = await call(actor, `staff_content()`);
      expect(Object.keys(content).sort()).toEqual(['announcements', 'faqs', 'gallery', 'media', 'site_content', 'testimonials']);
      expect(content.faqs.some((f: any) => !f.is_published)).toBe(true);
      expect(content.faqs[0]).toEqual(expect.objectContaining({ id: expect.any(String), updated_at: expect.any(String), answer: expect.any(Array) }));
      expect(content.site_content.map((c: any) => c.key)).toEqual(['contact', 'homepage.hero']);
    }
    await db.query(`update faqs set is_published = true`);
  });
});

describe('FAQs', () => {
  it('create (unpublished), edit, publish, and the audit trail', async () => {
    const created = await call('admin', `staff_save_faq(null, null, $1)`, [j(FAQ)]);
    expect(created.is_published).toBe(false);
    expect(await one(db, `select question, answer, is_published from faqs where id = $1`, [created.id]))
      .toEqual({ question: FAQ.question, answer: FAQ.answer, is_published: false });
    expect(await lastAudit('faqs', created.id)).toMatchObject({ actor_id: id.admin, actor_role: 'admin', actor_kind: 'staff', action: 'content.faq_created' });
    // A guest does not see it yet.
    expect(await as('guest', () => rows(db, `select id from faqs where id = $1`, [created.id]))).toEqual([]);

    const edited = await call('owner', `staff_save_faq($1, $2, $3)`, [created.id, await version('faqs', created.id), j({ ...FAQ, question: 'Do you offer sessions for two?' })]);
    expect(await lastAudit('faqs', created.id)).toMatchObject({
      actor_id: id.owner, action: 'content.faq_updated',
      changes: { question: { old: FAQ.question, new: 'Do you offer sessions for two?' } },
    });
    expect(edited.is_published).toBe(false);

    const published = await call('admin', `staff_set_content_published('faq', $1, true, $2)`, [created.id, await version('faqs', created.id)]);
    expect(published.is_published).toBe(true);
    expect(await lastAudit('faqs', created.id)).toMatchObject({ action: 'content.published', changes: { is_published: { old: false, new: true } } });
    expect(await as('guest', () => rows(db, `select question from faqs where id = $1`, [created.id]))).toEqual([{ question: 'Do you offer sessions for two?' }]);
  });

  it('refuses invalid content', async () => {
    const bad = [
      null, [], 'text', {}, { question: 'Hi', answer: ['A'] }, { question: 'Valid question?', answer: [] }, { question: 'Valid question?', answer: 'not a list' },
      { question: 'Valid question?', answer: ['', '  '] }, { question: 'x'.repeat(301), answer: ['A'] }, { question: 'Valid question?', answer: ['y'.repeat(2001)] },
      { question: 'Valid question?', answer: Array(11).fill('A') }, { question: 'Valid question?', answer: ['A'], sort_order: 'first' },
    ];
    for (const fields of bad) {
      expect(await outcome('admin', `staff_save_faq(null, null, $1)`, [fields === null ? null : j(fields)]), j(fields)).toBe('invalid_content');
    }
  });

  it('an edit from an out-of-date version is refused and changes nothing', async () => {
    const faq = await call('admin', `staff_save_faq(null, null, $1)`, [j({ question: 'First version?', answer: ['One'] })]);
    const seen = await version('faqs', faq.id);
    await call('owner', `staff_save_faq($1, $2, $3)`, [faq.id, seen, j({ question: 'Owner version?', answer: ['Two'] })]);
    expect(await outcome('admin', `staff_save_faq($1, $2, $3)`, [faq.id, seen, j({ question: 'Admin version?', answer: ['Three'] })])).toBe('stale_record');
    expect(await outcome('admin', `staff_save_faq($1, null, $2)`, [faq.id, j({ question: 'No version?', answer: ['Four'] })])).toBe('stale_record');
    expect(await outcome('admin', `staff_set_content_published('faq', $1, true, $2)`, [faq.id, seen])).toBe('stale_record');
    expect(await outcome('admin', `staff_delete_content('faq', $1, 'Tidying up', $2)`, [faq.id, seen])).toBe('stale_record');
    expect(await one(db, `select question, is_published from faqs where id = $1`, [faq.id])).toEqual({ question: 'Owner version?', is_published: false });
    expect(await outcome('admin', `staff_save_faq($1, now(), $2)`, [crypto.randomUUID(), j(FAQ)])).toBe('not_found');
  });
});

describe('deleting', () => {
  it('needs a reason, is refused while the item is on the website, and is recorded with the reason', async () => {
    const faq = await call('admin', `staff_save_faq(null, null, $1)`, [j({ question: 'Soon to be removed?', answer: ['Yes'] })]);
    await call('admin', `staff_set_content_published('faq', $1, true, $2)`, [faq.id, await version('faqs', faq.id)]);
    const v = await version('faqs', faq.id);
    for (const reason of [null, '', 'ab']) {
      expect(await outcome('admin', `staff_delete_content('faq', $1, $2, $3)`, [faq.id, reason, v])).toBe('reason_required');
    }
    expect(await outcome('admin', `staff_delete_content('faq', $1, 'No longer true', $2)`, [faq.id, v])).toBe('still_published');
    expect(await rows(db, `select 1 from faqs where id = $1`, [faq.id])).toHaveLength(1);

    await call('admin', `staff_set_content_published('faq', $1, false, $2)`, [faq.id, v]);
    expect(await lastAudit('faqs', faq.id)).toMatchObject({ action: 'content.unpublished' });
    expect(await outcome('owner', `staff_delete_content('faq', $1, 'No longer true', $2)`, [faq.id, await version('faqs', faq.id)])).toBe('ok');
    expect(await rows(db, `select 1 from faqs where id = $1`, [faq.id])).toEqual([]);
    const entry = await lastAudit('faqs', faq.id);
    expect(entry).toMatchObject({ actor_id: id.owner, action: 'content.faq_deleted', reason: 'No longer true' });
    expect(entry.changes.question).toEqual({ old: 'Soon to be removed?' }); // what was removed stays on record
  });

  it('refuses an unknown kind', async () => {
    const faq = await one(db, `select id, updated_at::text as v from faqs limit 1`);
    for (const kind of ['faqs', 'media', 'site_content', 'profiles', `faq'; drop table faqs; --`, null]) {
      expect(await outcome('admin', `staff_delete_content($1, $2, 'Any reason', $3)`, [kind, faq.id, faq.v]), String(kind)).toBe('invalid_content');
      expect(await outcome('admin', `staff_set_content_published($1, $2, false, $3)`, [kind, faq.id, faq.v]), String(kind)).toBe('invalid_content');
      expect(await outcome('admin', `staff_reorder_content($1, $2)`, [kind, [faq.id]]), String(kind)).toBe('invalid_content');
    }
    expect(await outcome('admin', `staff_reorder_content('announcement', $1)`, [[]])).toBe('invalid_content'); // announcements have no order
    expect(await rows(db, `select 1 from faqs where id = $1`, [faq.id])).toHaveLength(1);
  });
});

describe('ordering', () => {
  it('puts the whole list in the given order, and refuses a list that is out of date', async () => {
    const ids = (await rows(db, `select id from faqs order by sort_order, created_at`)).map((r) => r.id);
    const reversed = [...ids].reverse();
    await call('admin', `staff_reorder_content('faq', $1)`, [reversed]);
    expect((await rows(db, `select id from faqs order by sort_order`)).map((r) => r.id)).toEqual(reversed);
    expect(await as('guest', () => rows(db, `select id from faqs order by sort_order`))).not.toEqual([]);
    expect(await one(db, `select count(*)::int as n from audit_log where action = 'content.reordered' and actor_id = $1`, [id.admin])).not.toEqual({ n: 0 });

    for (const list of [ids.slice(1), [...ids, crypto.randomUUID()], [...ids.slice(1), ids[1]], []]) {
      expect(await outcome('admin', `staff_reorder_content('faq', $1)`, [list])).toBe('stale_record');
    }
    expect((await rows(db, `select id from faqs order by sort_order`)).map((r) => r.id)).toEqual(reversed);
  });
});

describe('testimonials', () => {
  it('are created unpublished, validated, and audited without the person\'s name', async () => {
    const created = await call('admin', `staff_save_testimonial(null, null, $1)`, [j(TESTIMONIAL)]);
    expect(await one(db, `select author_name, rating, is_published from testimonials where id = $1`, [created.id]))
      .toEqual({ author_name: 'Verified Guest', rating: 5, is_published: false });
    await call('admin', `staff_save_testimonial($1, $2, $3)`, [created.id, await version('testimonials', created.id),
      j({ ...TESTIMONIAL, author_name: 'Private Person', author_location: 'Abuja', rating: 4 })]);
    const entry = await lastAudit('testimonials', created.id);
    expect(entry).toMatchObject({ action: 'content.testimonial_updated' });
    expect(entry.changes).toEqual({ author_name: { changed: true }, author_location: { changed: true }, rating: { old: 5, new: 4 } });
    expect(JSON.stringify(await rows(db, `select changes from audit_log where entity_type = 'testimonials'`))).not.toMatch(/Private Person|Verified Guest|Abuja/);

    const service = await one(db, `select id from services limit 1`);
    expect(await outcome('admin', `staff_save_testimonial(null, null, $1)`, [j({ ...TESTIMONIAL, service_id: service.id })])).toBe('ok');
    for (const fields of [
      { ...TESTIMONIAL, rating: 6 }, { ...TESTIMONIAL, rating: 0 }, { ...TESTIMONIAL, rating: null }, { ...TESTIMONIAL, body: 'Short' },
      { ...TESTIMONIAL, author_name: 'A' }, { ...TESTIMONIAL, body: 'z'.repeat(1001) }, { ...TESTIMONIAL, service_id: crypto.randomUUID() },
      { ...TESTIMONIAL, service_id: 'not-an-id' },
    ]) {
      expect(await outcome('admin', `staff_save_testimonial(null, null, $1)`, [j(fields)]), j(fields)).toBe('invalid_content');
    }
  });
});

describe('announcements', () => {
  it('follow the same rules, with their dates checked', async () => {
    const created = await call('owner', `staff_save_announcement(null, null, $1)`, [j({ ...ANNOUNCEMENT, starts_at: '2030-01-01T08:00:00Z', ends_at: '2030-01-31T18:00:00Z' })]);
    expect(await one(db, `select kind, is_published from announcements where id = $1`, [created.id])).toEqual({ kind: 'promotion', is_published: false });
    await call('owner', `staff_set_content_published('announcement', $1, true, $2)`, [created.id, await version('announcements', created.id)]);
    expect(await outcome('owner', `staff_delete_content('announcement', $1, 'Promotion over', $2)`, [created.id, await version('announcements', created.id)])).toBe('still_published');
    for (const fields of [
      { ...ANNOUNCEMENT, kind: 'advert' }, { ...ANNOUNCEMENT, title: 'X' }, { ...ANNOUNCEMENT, body: 'b'.repeat(1001) },
      { ...ANNOUNCEMENT, starts_at: '2030-02-01T00:00:00Z', ends_at: '2030-01-01T00:00:00Z' }, { ...ANNOUNCEMENT, starts_at: 'tomorrow-ish' },
    ]) {
      expect(await outcome('admin', `staff_save_announcement(null, null, $1)`, [j(fields)]), j(fields)).toBe('invalid_content');
    }
  });
});

describe('site content blocks', () => {
  it('only the known blocks exist, holding known text fields', async () => {
    const before = await version('site_content', 'contact', 'key');
    const saved = await call('admin', `staff_save_site_content('contact', $1, $2)`, [before, j(CONTACT)]);
    expect(saved).toMatchObject({ key: 'contact', is_published: true });
    expect(await one(db, `select value, is_demo, updated_by from site_content where key = 'contact'`))
      .toEqual({ value: CONTACT, is_demo: false, updated_by: id.admin });
    expect(await lastAudit('site_content', 'contact')).toMatchObject({ actor_id: id.admin, action: 'content.site_content_updated' });
    expect(await as('guest', () => one(db, `select value from site_content where key = 'contact'`))).toEqual({ value: CONTACT });

    const v = await version('site_content', 'contact', 'key');
    const refused: [string, unknown][] = [
      ['footer', { text: 'New block' }], ['contact', { ...CONTACT, note: 'extra' }], ['contact', { ...CONTACT, phone: 'call me' }],
      ['contact', { ...CONTACT, email: 'not-an-email' }], ['contact', { ...CONTACT, address: { street: '1' } }], ['contact', ['a']],
      ['contact', { ...CONTACT, address: 'a'.repeat(301) }], ['homepage.hero', { heading: 'h'.repeat(121) }], ['homepage.hero', { html: '<b>x</b>' }],
    ];
    for (const [key, value] of refused) {
      expect(await outcome('admin', `staff_save_site_content($1, $2, $3)`, [key, v, j(value)]), `${key} ${j(value)}`).toBe('invalid_content');
    }
    expect(await outcome('admin', `staff_save_site_content('contact', $1, $2)`, [before, j(CONTACT)])).toBe('stale_record');
    expect(await rows(db, `select key from site_content order by key`)).toEqual([{ key: 'contact' }, { key: 'homepage.hero' }]);
  });

  it('a block that was never saved is created with no version, once', async () => {
    await db.query(`delete from site_content where key = 'homepage.hero'`);
    const listed = (await call('owner', `staff_content()`)).site_content.find((c: any) => c.key === 'homepage.hero');
    expect(listed).toEqual({ key: 'homepage.hero', value: null, is_published: false, updated_at: null });
    expect(await outcome('owner', `staff_save_site_content('homepage.hero', now(), $1)`, [j({ heading: 'Rest well' })])).toBe('stale_record');
    expect(await outcome('owner', `staff_save_site_content('homepage.hero', null, $1, false)`, [j({ heading: 'Rest well', subheading: null })])).toBe('ok');
    expect(await outcome('owner', `staff_save_site_content('homepage.hero', null, $1)`, [j({ heading: 'Again' })])).toBe('stale_record');
    expect(await as('guest', () => rows(db, `select key from site_content where key = 'homepage.hero'`))).toEqual([]); // saved unpublished
  });
});

describe('media library and gallery', () => {
  it('only a file the server stored, at a generated path, can be added', async () => {
    const path = await storedFile('gallery', 'png');
    const added = await call('admin', `staff_register_media($1, 4096, 1200, 800, '  Treatment room  ')`, [path]);
    expect(added).toMatchObject({ bucket: 'site-media', path, mime_type: 'image/png', alt_text: 'Treatment room' });
    expect(await one(db, `select created_by, size_bytes::int as size_bytes, width, height from media_assets where id = $1`, [added.id]))
      .toEqual({ created_by: id.admin, size_bytes: 4096, width: 1200, height: 800 });
    expect(await lastAudit('media_assets', added.id)).toMatchObject({ actor_id: id.admin, action: 'content.media_added' });
    expect(await outcome('admin', `staff_register_media($1, 4096)`, [path])).toBe('media_exists');

    const missing = `gallery/${crypto.randomUUID()}.png`;
    expect(await outcome('admin', `staff_register_media($1, 4096)`, [missing])).toBe('media_not_uploaded');
    const real = await storedFile('site', 'jpg');
    for (const [p, size, w] of [
      ['gallery/photo.png', 10, 10], ['../secret/' + crypto.randomUUID() + '.png', 10, 10], [`private/${crypto.randomUUID()}.png`, 10, 10],
      [`gallery/${crypto.randomUUID()}.svg`, 10, 10], [`gallery/${crypto.randomUUID()}.html`, 10, 10], [`gallery/${crypto.randomUUID()}.png.exe`, 10, 10],
      [real, 0, 10], [real, 5242881, 10], [real, 10, 0], [real, 10, 20001], [null, 10, 10],
    ] as [string | null, number, number][]) {
      expect(await outcome('admin', `staff_register_media($1, $2, $3, 10)`, [p, size, w]), `${p} ${size} ${w}`).toBe('invalid_media');
    }
    expect(await outcome('admin', `staff_register_media($1, 10, 10, 10, $2)`, [real, 'a'.repeat(301)])).toBe('invalid_media');
  });

  it('a gallery item uses an uploaded file or a site asset, never an arbitrary address', async () => {
    const m = await media();
    const item = await call('admin', `staff_save_gallery_item(null, null, $1)`, [j({ title: 'Quiet room', category: 'Sanctuary', image_media_id: m.id, image_url: '/assets/ignored.jpg' })]);
    expect(await one(db, `select category, image_url, image_media_id, is_published from gallery_items where id = $1`, [item.id]))
      .toEqual({ category: 'sanctuary', image_url: null, image_media_id: m.id, is_published: false });
    expect(await outcome('admin', `staff_save_gallery_item(null, null, $1)`, [j({ title: 'Stones', image_url: '/assets/images/stones.jpg' })])).toBe('ok');
    for (const fields of [
      { title: 'No image' }, { title: 'X', image_url: '/assets/a.jpg' }, { title: 'Remote', image_url: 'https://evil.example/x.jpg' },
      { title: 'Script', image_url: 'javascript:alert(1)' }, { title: 'Climb', image_url: '/assets/../../etc/passwd' }, { title: 'Data', image_url: 'data:image/png;base64,AAAA' },
      { title: 'Other root', image_url: '/staff/x.jpg' }, { title: 'Bad category', image_url: '/assets/a.jpg', category: '<script>' },
    ]) {
      expect(await outcome('admin', `staff_save_gallery_item(null, null, $1)`, [j(fields)]), j(fields)).toBe('invalid_content');
    }
    expect(await outcome('admin', `staff_save_gallery_item(null, null, $1)`, [j({ title: 'Ghost', image_media_id: crypto.randomUUID() })])).toBe('media_not_found');
  });

  it('a file in use cannot be removed; an unused one can, with a reason', async () => {
    const m = await media('owner');
    const item = await call('admin', `staff_save_gallery_item(null, null, $1)`, [j({ title: 'In use', image_media_id: m.id })]);
    expect((await call('admin', `staff_content()`)).media.find((x: any) => x.id === m.id).uses).toBe(1);
    expect(await outcome('admin', `staff_remove_media($1, 'Tidying the library', $2)`, [m.id, m.updated_at])).toBe('media_in_use'); // even while unpublished
    expect(await outcome('admin', `staff_remove_media($1, null, $2)`, [m.id, m.updated_at])).toBe('reason_required');

    const updated = await call('admin', `staff_update_media($1, $2, 'A better description')`, [m.id, m.updated_at]);
    expect(updated.alt_text).toBe('A better description');
    expect(await outcome('admin', `staff_update_media($1, $2, 'Stale edit')`, [m.id, m.updated_at])).toBe('stale_record');
    expect(await outcome('admin', `staff_update_media($1, $2, $3)`, [m.id, await version('media_assets', m.id), 'a'.repeat(301)])).toBe('invalid_media');

    await call('admin', `staff_delete_content('gallery', $1, 'Replaced by a better photo', $2)`, [item.id, await version('gallery_items', item.id)]);
    expect(await outcome('admin', `staff_remove_media($1, 'Tidying the library', $2)`, [m.id, m.updated_at])).toBe('stale_record');
    const removed = await call('admin', `staff_remove_media($1, 'Tidying the library', $2)`, [m.id, await version('media_assets', m.id)]);
    expect(removed).toEqual({ id: m.id, bucket: 'site-media', path: m.path });
    expect(await lastAudit('media_assets', m.id)).toMatchObject({ actor_id: id.admin, action: 'content.media_removed', reason: 'Tidying the library' });
    expect(await outcome('admin', `staff_remove_media($1, 'Again', now())`, [m.id])).toBe('not_found');
  });

  it('a file used by a service or a therapist cannot be removed either', async () => {
    const [a, b] = [await media(), await media()];
    await db.query(`update services set image_media_id = $1 where id = (select id from services order by sort_order limit 1)`, [a.id]);
    await db.query(`update therapists set photo_media_id = $1 where sort_order = 1`, [b.id]);
    expect(await outcome('owner', `staff_remove_media($1, 'Tidying the library', $2)`, [a.id, a.updated_at])).toBe('media_in_use');
    expect(await outcome('owner', `staff_remove_media($1, 'Tidying the library', $2)`, [b.id, b.updated_at])).toBe('media_in_use');
  });
});

describe('what stays out of reach', () => {
  it('no content function touches settings, and allow_demo_payments has no staff function', async () => {
    const touching = await rows(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') and p.prosrc ~* 'allow_demo_payments'
        and p.prosrc ~* '(update|insert)[^;]*allow_demo_payments'`);
    expect(touching).toEqual([]);
    const content = await rows(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname ~ '^staff_(content|save_faq|save_testimonial|save_gallery_item|save_announcement|save_site_content|set_content_published|reorder_content|delete_content|register_media|update_media|remove_media)$'
        and p.prosrc ~* '(business_settings|payments|appointments|customers|profiles|booking_holds|intake)'`);
    expect(content).toEqual([]);
  });
});
