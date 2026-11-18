import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packagesData, servicesData } from '../../src/data';
import { formatMoney, toMinorUnits } from '../../src/lib/money';
import { getCatalog, getTherapists, mapCatalog, mapTherapist, type PackageItemRow, type ServiceRow, type TherapistRow } from '../../src/services/catalogService';
import { asRole, createTestDb, rows } from '../db/harness';

describe('money', () => {
  it('formats minor units the way the site displays prices', () => {
    expect(formatMoney(4500000)).toBe('₦45,000');
    expect(formatMoney(4500050)).toBe('₦45,000.50');
    expect(toMinorUnits(45000)).toBe(4500000);
  });
});

describe('catalogue without Supabase configured', () => {
  it('falls back to the static site content', async () => {
    const catalog = await getCatalog();
    expect(catalog.services.map((s) => s.id)).toEqual(servicesData.map((s) => s.id));
    expect(catalog.packages.map((p) => p.id)).toEqual(packagesData.map((p) => p.id));
    expect(catalog.services[0].dbId).toBeNull();
    expect(await getTherapists()).toHaveLength(4);
  });
});

describe('catalogue from the database', () => {
  it('after the price-list update, guests read exactly the six treatments on the website, mapped into the shape the site uses', async () => {
    const db = await createTestDb();
    // The client's price list (supabase/snippets/catalogue_price_list_2026_11.sql), twice: it is safe to run again.
    const update = readFileSync(path.resolve(__dirname, '../../supabase/snippets/catalogue_price_list_2026_11.sql'), 'utf8');
    await db.exec(update);
    await db.exec(update);

    const { serviceRows, itemRows, therapistRows } = await asRole(db, 'anon', null, async () => ({
      serviceRows: await rows<ServiceRow>(db, `select * from services order by sort_order`),
      itemRows: await rows<PackageItemRow>(db, `select * from service_package_items`),
      therapistRows: await rows<TherapistRow>(db, `select * from therapists order by sort_order`),
    }));
    // node-postgres style drivers return bigint as string/bigint; PostgREST returns numbers.
    const normalised = serviceRows.map((r) => ({
      ...r,
      price_minor: Number(r.price_minor),
      compare_at_price_minor: r.compare_at_price_minor === null ? null : Number(r.compare_at_price_minor),
    }));

    const catalog = mapCatalog(normalised, itemRows);

    // Same content as the static site; Nuru, Thai and the invented packages are switched off.
    expect(catalog.services.map(({ dbId, bufferMinutes, currency, ...s }) => s)).toEqual(servicesData);
    expect(catalog.services.every((s) => s.dbId && s.bufferMinutes === 15)).toBe(true);
    expect(catalog.packages.map(({ dbId, bufferMinutes, currency, ...p }) => p)).toEqual(
      packagesData.map((p) => ({ ...p, popular: p.popular ?? false })),
    );

    const therapists = therapistRows.map((r) => mapTherapist(r));
    expect(therapists.map((t) => t.name)).toEqual([
      'Senior Massage Therapist', 'Lead Spa Therapist', 'Skincare & Facial Specialist', 'Wellness Therapist',
    ]);
    expect(therapists[0].avatarUrl).toBe('/assets/images/team/therapist-1.jpg');
  });

  it('prefers Storage media over the legacy image path', () => {
    const row: ServiceRow = {
      id: 'a', slug: 'swedish', name: 'Swedish Massage', category: 'Relaxation', description: '', benefits: [],
      duration_minutes: 60, buffer_minutes: 15, price_minor: 4000000, compare_at_price_minor: null, currency: 'NGN',
      is_package: false, is_popular: false, image_url: '/assets/legacy.jpg', image_media_id: 'm1',
    };
    const media = new Map([['m1', 'https://project.supabase.co/storage/v1/object/public/site-media/services/swedish.webp']]);
    expect(mapCatalog([row], [], media).services[0].imageUrl).toBe(media.get('m1'));
    expect(mapCatalog([row], []).services[0].imageUrl).toBe('/assets/legacy.jpg');
  });
});
