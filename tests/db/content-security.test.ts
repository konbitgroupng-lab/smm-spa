import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createStaff, createTestDb, one, rows } from './harness';

// Phase 6a: the website content tables. Nobody writes to them directly, guests
// read only what the website shows, media rows are public only while in use,
// every change is audited, and staff have no direct access to Storage.

let db: PGlite;
const id: Record<string, string> = {};

const CONTENT_TABLES = ['announcements', 'faqs', 'gallery_items', 'media_assets', 'site_content', 'testimonials'];
type Actor = 'guest' | 'newAccount' | 'inactiveAdmin' | 'therapist' | 'admin' | 'owner';
const ACTORS: Actor[] = ['guest', 'newAccount', 'inactiveAdmin', 'therapist', 'admin', 'owner'];
const as = <T>(actor: Actor, fn: () => Promise<T>) =>
  actor === 'guest' ? asRole(db, 'anon', null, fn) : asRole(db, 'authenticated', id[actor], fn);

const PUBLIC_COLUMNS: Record<string, string[]> = {
  announcements: ['body', 'ends_at', 'id', 'is_published', 'kind', 'starts_at', 'title'],
  faqs: ['answer', 'id', 'is_published', 'question', 'sort_order'],
  gallery_items: ['category', 'id', 'image_media_id', 'image_url', 'is_published', 'sort_order', 'title'],
  media_assets: ['alt_text', 'bucket', 'height', 'id', 'path', 'width'],
  site_content: ['is_published', 'key', 'value'],
  testimonials: ['author_location', 'author_name', 'body', 'id', 'is_published', 'rating', 'service_id', 'sort_order'],
};

beforeAll(async () => {
  db = await createTestDb();
  id.owner = await createStaff(db, 'owner@example.com', 'owner');
  id.admin = await createStaff(db, 'admin@example.com', 'admin');
  id.therapist = await createStaff(db, 'therapist@example.com', 'therapist');
  id.inactiveAdmin = await createStaff(db, 'gone@example.com', 'admin', { active: false });
  id.newAccount = (await one(db, `insert into auth.users (email) values ('new@example.com') returning id`)).id;
  await db.query(`insert into announcements (title, body, is_published) values ('Open on Sunday', 'This week only', true), ('Draft notice', '', false)`);
});

describe('direct writes are refused for everyone', () => {
  const writes: Record<string, string[]> = {
    faqs: [`insert into faqs (question, answer) values ('Q?', array['A'])`, `update faqs set question = 'changed'`, `delete from faqs`],
    testimonials: [`insert into testimonials (author_name, body, rating) values ('X', 'Lovely', 5)`, `update testimonials set is_published = true`, `delete from testimonials`],
    gallery_items: [`insert into gallery_items (title, image_url) values ('X', '/assets/x.jpg')`, `update gallery_items set title = 'changed'`, `delete from gallery_items`],
    announcements: [`insert into announcements (title) values ('X')`, `update announcements set is_published = true`, `delete from announcements`],
    site_content: [`insert into site_content (key, value) values ('x', '{}')`, `update site_content set value = '{}'`, `delete from site_content`],
    media_assets: [`insert into media_assets (path) values ('gallery/x.png')`, `update media_assets set alt_text = 'changed'`, `delete from media_assets`],
  };

  it.each(ACTORS)('%s cannot insert, update or delete in any content table', async (actor) => {
    for (const [table, statements] of Object.entries(writes)) {
      for (const sql of statements) {
        await expect(as(actor, () => db.query(sql)), `${actor}: ${sql}`).rejects.toThrow(new RegExp(`permission denied for table ${table}`));
      }
    }
  });

  it('no role holds a write privilege on them, on the table or on any column', async () => {
    expect(await rows(db, `select grantee, table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = any ($1) and grantee in ('anon', 'authenticated', 'PUBLIC')`, [CONTENT_TABLES])).toEqual([]);
    expect(await rows(db, `select grantee, table_name, column_name, privilege_type from information_schema.column_privileges
      where table_schema = 'public' and table_name = any ($1) and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type <> 'SELECT'`, [CONTENT_TABLES])).toEqual([]);
  });

  it('no policy lets a signed-in user manage them', async () => {
    const policies = await rows(db, `select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename = any ($1) order by 1, 2`, [CONTENT_TABLES]);
    expect(policies.every((p) => p.cmd === 'SELECT'), JSON.stringify(policies)).toBe(true);
    expect(policies.map((p) => `${p.tablename}: ${p.policyname}`)).toEqual([
      'announcements: public read current', 'faqs: public read published', 'gallery_items: public read published',
      'media_assets: public read in use', 'site_content: public read published', 'testimonials: public read published',
    ]);
  });
});

describe('what guests and signed-in users can read', () => {
  it.each(['anon', 'authenticated'])('%s: exactly the columns the website shows', async (role) => {
    for (const table of CONTENT_TABLES) {
      const readable = (await rows(db, `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = $1 and has_column_privilege($2, format('public.%I', table_name), column_name, 'select')
        order by 1`, [table, role])).map((r) => r.column_name);
      expect(readable, table).toEqual(PUBLIC_COLUMNS[table]);
    }
  });

  it('staff account ids, descriptions, demo flags and timestamps are refused', async () => {
    const hidden = [
      `select updated_by from site_content`, `select description from site_content`, `select is_demo from site_content`,
      `select created_by from media_assets`, `select mime_type from media_assets`, `select size_bytes from media_assets`,
      `select is_demo from faqs`, `select updated_at from faqs`, `select created_at from testimonials`, `select is_demo from gallery_items`,
      `select * from faqs`, `select * from testimonials`, `select * from gallery_items`, `select * from announcements`,
      `select * from site_content`, `select * from media_assets`,
    ];
    for (const actor of ACTORS) {
      for (const sql of hidden) {
        await expect(as(actor, () => db.query(sql)), `${actor}: ${sql}`).rejects.toThrow(/permission denied/);
      }
    }
  });

  it('published content is still readable, unpublished content is not, for every actor alike', async () => {
    await db.query(`update faqs set is_published = false where sort_order = 1`);
    await db.query(`update site_content set is_published = false where key = 'homepage.hero'`);
    const all = Number((await one(db, `select count(*) from faqs`)).count);
    for (const actor of ACTORS) {
      const seen = await as(actor, async () => ({
        faqs: await rows(db, `select id, question, answer from faqs order by sort_order`),
        testimonials: await rows(db, `select author_name, body, rating from testimonials`),
        gallery: await rows(db, `select title, image_url from gallery_items`),
        announcements: await rows(db, `select title from announcements`),
        content: await rows(db, `select key from site_content`),
      }));
      expect(seen.faqs, actor).toHaveLength(all - 1);
      expect(seen.testimonials.length, actor).toBeGreaterThan(0);
      expect(seen.gallery.length, actor).toBeGreaterThan(0);
      expect(seen.announcements, actor).toEqual([{ title: 'Open on Sunday' }]);
      expect(seen.content, actor).toEqual([{ key: 'contact' }]);
    }
    await db.query(`update faqs set is_published = true`);
    await db.query(`update site_content set is_published = true`);
  });

  it('a media row is visible only while something public uses it', async () => {
    const media = async (path: string) => (await one(db, `insert into media_assets (path) values ($1) returning id`, [path])).id;
    const unused = await media('gallery/unused.webp');
    const inPublished = await media('gallery/published.webp');
    const inDraft = await media('gallery/draft.webp');
    const onService = await media('services/active.webp');
    const onInactiveService = await media('services/inactive.webp');
    const onTherapist = await media('therapists/active.webp');
    await db.query(`insert into gallery_items (title, image_media_id, is_published) values ('Shown', $1, true), ('Hidden', $2, false)`, [inPublished, inDraft]);
    const services = await rows(db, `select id from services order by sort_order limit 2`);
    await db.query(`update services set image_media_id = $2 where id = $1`, [services[0].id, onService]);
    await db.query(`update services set image_media_id = $2, is_active = false where id = $1`, [services[1].id, onInactiveService]);
    await db.query(`update therapists set photo_media_id = $1 where sort_order = 1`, [onTherapist]);

    for (const actor of ACTORS) {
      const seen = (await as(actor, () => rows(db, `select id from media_assets`))).map((r) => r.id).sort();
      expect(seen, actor).toEqual([inPublished, onService, onTherapist].sort());
    }
    // The website's own queries still work as a guest.
    const joined = await as('guest', () => rows(db, `select g.title, m.bucket, m.path from gallery_items g join media_assets m on m.id = g.image_media_id`));
    expect(joined).toEqual([{ title: 'Shown', bucket: 'site-media', path: 'gallery/published.webp' }]);
    expect(unused).toBeTruthy();
    await db.query(`update services set is_active = true, image_media_id = null where id = any ($1)`, [services.map((s) => s.id)]);
  });
});

describe('audit', () => {
  it('every content table is audited', async () => {
    const audited = (await rows(db, `select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgname = 'audit_row_change' and c.relname = any ($1) order by 1`, [CONTENT_TABLES])).map((r) => r.relname);
    expect(audited).toEqual(CONTENT_TABLES);
  });

  it('a change made outside the staff functions is still recorded, as system', async () => {
    const faq = await one(db, `select id from faqs order by sort_order limit 1`);
    await asRole(db, 'service_role', null, () => db.query(`update faqs set question = 'Changed by a server process?' where id = $1`, [faq.id]));
    const entry = await one(db, `select actor_kind, action, changes from audit_log where entity_type = 'faqs' and entity_id = $1 order by id desc limit 1`, [faq.id]);
    expect(entry).toMatchObject({ actor_kind: 'system', action: 'update' });
    expect(entry.changes.question.new).toBe('Changed by a server process?');
  });
});

describe('storage', () => {
  it('no signed-in user or guest can upload, list, replace or delete site media directly', async () => {
    await db.query(`insert into storage.objects (bucket_id, name) values ('site-media', 'gallery/existing.webp')`);
    expect(await rows(db, `select policyname from pg_policies where schemaname = 'storage'`)).toEqual([]);
    for (const actor of ACTORS) {
      await expect(as(actor, () => db.query(`insert into storage.objects (bucket_id, name) values ('site-media', 'gallery/' || gen_random_uuid() || '.webp')`)), actor)
        .rejects.toThrow(/row-level security/);
      expect(await as(actor, () => rows(db, `select name from storage.objects`)), actor).toEqual([]);
      expect((await as(actor, () => db.query(`update storage.objects set name = 'gallery/replaced.webp'`))).affectedRows, actor).toBe(0);
      expect((await as(actor, () => db.query(`delete from storage.objects`))).affectedRows, actor).toBe(0);
    }
    expect(await rows(db, `select name from storage.objects`)).toEqual([{ name: 'gallery/existing.webp' }]);
  });
});
