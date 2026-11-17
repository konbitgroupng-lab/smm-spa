import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, one } from '../db/harness';
import { startLocalBackend } from '../support/local-backend';

// The public site's content reads (Phase 6c), over HTTP as a guest, against
// the real database rules: only published items, only the columns the site shows.

let db: PGlite;
let backend: { url: string; close(): Promise<void> };
let service: typeof import('../../src/services/contentService');

beforeAll(async () => {
  db = await createTestDb();
  backend = await startLocalBackend(db, 'http://localhost:3000');
  vi.stubEnv('VITE_SUPABASE_URL', backend.url);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-tests');
  vi.resetModules();
  service = await import('../../src/services/contentService');

  // What the owner might have set up in the staff app.
  await db.query(`delete from testimonials`);
  const swedish = await one(db, `select id from services where slug = 'swedish'`);
  await db.query(
    `insert into testimonials (author_name, author_location, body, rating, service_id, sort_order, is_published) values
       ('Adaeze O.', 'Lekki', 'Calm, professional and on time.', 5, $1, 1, true),
       ('Hidden Guest', null, 'Not approved for the website yet.', 4, null, 2, false)`,
    [swedish.id],
  );
  await db.query(`insert into storage.objects (bucket_id, name) values ('site-media', 'gallery/11111111-1111-4111-8111-111111111111.jpg')`);
  const media = await one(db,
    `insert into media_assets (bucket, path, alt_text, mime_type, size_bytes) values
       ('site-media', 'gallery/11111111-1111-4111-8111-111111111111.jpg', 'Hot stones on a back', 'image/jpeg', 1000) returning id`);
  await db.query(`update gallery_items set is_published = true`);
  await db.query(`update gallery_items set image_media_id = $1 where sort_order = 2`, [media.id]);
  await db.query(`update gallery_items set is_published = false where sort_order = 5`);
  await db.query(
    `insert into announcements (kind, title, body, starts_at, ends_at, is_published) values
       ('promotion', 'December offer', '15% off packages', now() - interval '1 day', now() + interval '10 days', true),
       ('announcement', 'Ended last week', '', now() - interval '20 days', now() - interval '7 days', true),
       ('announcement', 'Draft', '', null, null, false)`);
  await db.query(`update site_content set value = '{"phone": "+234 811 859 9365", "whatsapp": "+234 811 859 9365"}', is_published = true where key = 'contact'`);
  await db.query(`update site_content set is_published = false where key = 'homepage.hero'`);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await backend?.close();
});

describe('guest content reads', () => {
  it('reviews: only published ones, with the treatment name', async () => {
    expect(await service.getTestimonials()).toEqual([
      { id: expect.any(String), name: 'Adaeze O.', location: 'Lekki', text: 'Calm, professional and on time.', rating: 5, serviceName: 'Swedish Massage' },
    ]);
  });

  it('gallery: published pictures in order; an uploaded picture is served from storage with its description', async () => {
    const gallery = await service.getGallery();
    expect(gallery).toHaveLength(4);
    expect(gallery[1].imageUrl).toBe(`${backend.url}/storage/v1/object/public/site-media/gallery/11111111-1111-4111-8111-111111111111.jpg`);
    expect(gallery[1].altText).toBe('Hot stones on a back');
    expect(gallery[0].imageUrl).toMatch(/^\/assets\/images\//);
  });

  it('announcements: published and current only', async () => {
    expect((await service.getAnnouncements()).map((a) => a.title)).toEqual(['December offer']);
  });

  it('site content: a published block is read; an unpublished one is not', async () => {
    expect(await service.getSiteContent('contact')).toEqual({ phone: '+234 811 859 9365', whatsapp: '+234 811 859 9365' });
    expect(await service.getSiteContent('homepage.hero')).toBeNull();
  });

  it('FAQs: the published questions in order', async () => {
    const faqs = await service.getFaqs();
    expect(faqs.length).toBeGreaterThan(0);
    expect(faqs[0].question).toBe('How long is a typical massage session?');
  });
});
