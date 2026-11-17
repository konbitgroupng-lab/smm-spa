// @vitest-environment jsdom
import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSupabaseBackend } from '../../src/staff/lib/backend';
import { STAFF_AUTH_OPTIONS } from '../../src/staff/lib/client';
import { createSupabaseOps, type StaffOps } from '../../src/staff/lib/ops';
import { createStaff, createTestDb } from '../db/harness';
import { installBrowserStubs } from '../site/browser-stubs';
import { startLocalBackend } from '../support/local-backend';

// Phase 6e: what staff change under Website reaches the public site, as a
// guest's browser loads it, through the real content functions and the real
// guest read rules. Nothing hidden ever reaches the guest.

configure({ asyncUtilTimeout: 30_000 });
vi.setConfig({ testTimeout: 180_000 });

const PASSWORD = 'correct horse battery';
let db: PGlite;
let backend: { url: string; close(): Promise<void> };
let AppRouter: ComponentType<{ search: string }>;
let business: typeof import('../../src/config/business');

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) };
}
async function signedIn(email: string): Promise<StaffOps> {
  const client = createClient(backend.url, 'local-anon-key', { auth: { ...STAFF_AUTH_OPTIONS, storage: memoryStorage(), storageKey: `t-${email}` } });
  await createSupabaseBackend(client).signIn(email, PASSWORD);
  return createSupabaseOps(client);
}

beforeAll(async () => {
  installBrowserStubs();
  db = await createTestDb();
  await db.query(`delete from testimonials`);
  await createStaff(db, 'owner@example.com', 'owner');
  backend = await startLocalBackend(db, 'http://localhost:3000', { staffPassword: PASSWORD });
  vi.stubEnv('VITE_SUPABASE_URL', backend.url);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-tests');
  vi.resetModules();
  AppRouter = (await import('../../src/AppRouter')).default;
  business = await import('../../src/config/business');
});
afterEach(() => {
  cleanup();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await backend?.close();
});

const faqSection = () => document.getElementById('faqs')!;

describe('staff content reaches the website', () => {
  it('hidden items stay hidden; shown ones appear; contact details drive the footer and WhatsApp links', async () => {
    const owner = await signedIn('owner@example.com');
    let c = await owner.content();

    // Prepared but hidden: none of it reaches the guest.
    const faq = await owner.saveFaq(null, null, { question: 'Is there parking at the sanctuary?', answer: ['Yes, two private spaces.'] });
    const review = await owner.saveTestimonial(null, null, { authorName: 'Adaeze O.', authorLocation: 'Lekki', body: 'Calm, professional and on time.', rating: 5, serviceId: null });
    const offer = await owner.saveAnnouncement(null, null, { kind: 'promotion', title: 'December offer', body: '15% off packages', startsAt: null, endsAt: null });
    await owner.saveContact(c.contact.updatedAt, {
      address: 'Plot 4, Admiralty Way, Lekki, Lagos', phone: '+234 811 859 9365', phone_secondary: null, email: 'hello@smm.example', whatsapp: '+234 700 000 0001',
    });

    render(<AppRouter search="" />);
    const footer = document.querySelector('footer')!;
    await within(footer).findByText('Plot 4, Admiralty Way, Lekki, Lagos');
    expect(within(footer).getByText('hello@smm.example')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('a[href^="https://wa.me/"]')!.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/2347000000001\?/));
    expect(within(faqSection()).queryByText('Is there parking at the sanctuary?')).toBeNull();
    expect(screen.queryByText('Adaeze O.')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Announcements' })).toBeNull();
    cleanup();

    // Shown: the guest sees each one.
    c = await owner.content();
    await owner.setPublished('faq', faq.id, true, c.faqs.find((f) => f.id === faq.id)!.updatedAt);
    await owner.setPublished('testimonial', review.id, true, c.testimonials.find((t) => t.id === review.id)!.updatedAt);
    await owner.setPublished('announcement', offer.id, true, c.announcements.find((a) => a.id === offer.id)!.updatedAt);
    await owner.reorder('faq', [faq.id, ...c.faqs.filter((f) => f.id !== faq.id).map((f) => f.id)]);

    render(<AppRouter search="" />);
    expect(await within(faqSection()).findByText('Is there parking at the sanctuary?')).toBeTruthy();
    // Moved to the top, so it is the first question.
    expect(within(faqSection()).getAllByRole('button')[0].textContent).toContain('Is there parking at the sanctuary?');
    expect(await screen.findByText('Adaeze O.')).toBeTruthy();
    expect(screen.getByRole('img', { name: '5 out of 5 stars' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Announcements' }).textContent).toContain('December offer');
    cleanup();

    // Taken off again: gone for the guest, and the built-in contact details return when the block is unpublished.
    c = await owner.content();
    await owner.setPublished('testimonial', review.id, false, c.testimonials.find((t) => t.id === review.id)!.updatedAt);
    await db.query(`update site_content set is_published = false where key = 'contact'`);
    business.setContactDetails(null);
    render(<AppRouter search="" />);
    await within(faqSection()).findByText('Is there parking at the sanctuary?');
    await waitFor(() => expect(screen.queryByText('Adaeze O.')).toBeNull());
    expect(within(document.querySelector('footer')!).getByText('9B Oki Lane, Mende, Maryland, Lagos.')).toBeTruthy();
  });

  it('a guest cannot read hidden rows, management columns or the staff content functions', async () => {
    const guest = createClient(backend.url, 'anon-key-for-tests', { auth: { persistSession: false } });
    const hidden = await guest.from('testimonials').select('author_name').eq('is_published', false);
    expect(hidden.data).toEqual([]);
    expect((await guest.from('faqs').select('id, is_demo')).error).not.toBeNull();
    expect((await guest.rpc('staff_content')).error).not.toBeNull();
  });
});
