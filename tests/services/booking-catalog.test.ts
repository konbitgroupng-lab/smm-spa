import { describe, expect, it } from 'vitest';
import { getDispatchZones, getTherapistServiceLinks, mapDispatchZone, type DispatchZoneRow } from '../../src/services/catalogService';
import { getBusinessSettings } from '../../src/services/contentService';
import { asRole, createTestDb, rows } from '../db/harness';

// The catalogue additions the booking funnel reads, checked against what a
// guest can actually read from the database.

describe('booking catalogue reads', () => {
  it('guests can read active dispatch zones and therapist-service links', async () => {
    const db = await createTestDb();
    await db.query(`update dispatch_zones set is_active = false where key = 'airport'`);
    const zones = await asRole(db, 'anon', null, () => rows<DispatchZoneRow>(db, `select id, key, name, fee_minor from dispatch_zones order by sort_order`));
    expect(zones.map((z) => z.key)).toEqual(['maryland', 'mainland', 'vi', 'lekki']);
    expect(mapDispatchZone(zones[2])).toMatchObject({ key: 'vi', name: 'Victoria Island', feeMinor: 800_000, formattedFee: '₦8,000' });

    const links = await asRole(db, 'anon', null, () => rows(db, `select therapist_id, service_id from therapist_services`));
    expect(links.length).toBeGreaterThan(0);

    const settings = await asRole(db, 'anon', null, () => rows(db, `select max_advance_days, min_lead_minutes, slot_interval_minutes, timezone from business_settings`));
    expect(settings).toEqual([{ max_advance_days: 60, min_lead_minutes: 120, slot_interval_minutes: 30, timezone: 'Africa/Lagos' }]);
  });

  it('without a backend these reads are empty rather than failing', async () => {
    expect(await getDispatchZones()).toEqual([]);
    expect((await getTherapistServiceLinks()).size).toBe(0);
    expect(await getBusinessSettings()).toBeNull();
  });
});
