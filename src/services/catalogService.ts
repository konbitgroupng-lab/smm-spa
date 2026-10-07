import { therapistsData, type Service, type SpaPackage, type Therapist } from '../data';
import { formatMoney, toMajorUnits } from '../lib/money';
import { isSupabaseConfigured, requireSupabase, storagePublicUrl } from '../lib/supabase';
import { staticCatalog } from './staticCatalog';

// Catalogue reads for the public site. Results keep the shape the existing
// components already use (src/data.ts), so sections can switch from static
// imports to these functions one at a time. Without Supabase configured they
// return the static content, which keeps the current site working.

export interface CatalogService extends Service {
  /** Database id; null when served from static content. `id` stays the slug. */
  dbId: string | null;
  bufferMinutes: number;
  currency: string;
}

export interface CatalogPackage extends SpaPackage {
  dbId: string | null;
  bufferMinutes: number;
  currency: string;
}

export interface CatalogTherapist extends Omit<Therapist, 'rating'> {
  dbId: string | null;
}

export interface Catalog {
  services: CatalogService[];
  packages: CatalogPackage[];
}

export interface ServiceRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  benefits: string[];
  duration_minutes: number;
  buffer_minutes: number;
  price_minor: number;
  compare_at_price_minor: number | null;
  currency: string;
  is_package: boolean;
  is_popular: boolean;
  image_url: string | null;
  image_media_id: string | null;
}

export interface PackageItemRow {
  package_id: string;
  service_id: string;
  sort_order: number;
}

export interface TherapistRow {
  id: string;
  display_name: string;
  title: string;
  specialty: string;
  bio: string;
  photo_url: string | null;
  photo_media_id: string | null;
}

interface MediaRow {
  id: string;
  bucket: string;
  path: string;
}

/** Maps media id -> public URL. */
export type MediaUrls = ReadonlyMap<string, string>;

function resolveImage(mediaId: string | null, fallbackUrl: string | null, media: MediaUrls): string {
  return (mediaId && media.get(mediaId)) || fallbackUrl || '';
}

function mapService(row: ServiceRow, media: MediaUrls): CatalogService {
  return {
    id: row.slug,
    dbId: row.id,
    name: row.name,
    category: row.category,
    duration: row.duration_minutes,
    bufferMinutes: row.buffer_minutes,
    price: toMajorUnits(row.price_minor),
    formattedPrice: formatMoney(row.price_minor, row.currency),
    currency: row.currency,
    description: row.description,
    benefits: row.benefits,
    imageUrl: resolveImage(row.image_media_id, row.image_url, media),
  };
}

export function mapCatalog(rows: ServiceRow[], items: PackageItemRow[], media: MediaUrls = new Map()): Catalog {
  const slugById = new Map(rows.map((row) => [row.id, row.slug]));
  const services: CatalogService[] = [];
  const packages: CatalogPackage[] = [];

  for (const row of rows) {
    const base = mapService(row, media);
    if (!row.is_package) {
      services.push(base);
      continue;
    }
    const originalMinor = row.compare_at_price_minor ?? row.price_minor;
    packages.push({
      ...base,
      includedServiceIds: items
        .filter((item) => item.package_id === row.id && slugById.has(item.service_id))
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item) => slugById.get(item.service_id)!),
      originalPrice: toMajorUnits(originalMinor),
      formattedOriginalPrice: formatMoney(originalMinor, row.currency),
      popular: row.is_popular,
    });
  }
  return { services, packages };
}

export function mapTherapist(row: TherapistRow, media: MediaUrls = new Map()): CatalogTherapist {
  return {
    id: row.id,
    dbId: row.id,
    name: row.display_name,
    role: row.title,
    specialty: row.specialty,
    bio: row.bio,
    avatarUrl: resolveImage(row.photo_media_id, row.photo_url, media),
  };
}

export { staticCatalog };

async function fetchMediaUrls(ids: (string | null)[]): Promise<MediaUrls> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const { data, error } = await requireSupabase().from('media_assets').select('id, bucket, path').in('id', wanted);
  if (error) throw error;
  return new Map((data as MediaRow[]).map((m) => [m.id, storagePublicUrl(m.bucket, m.path)]));
}

/** Active services and packages, in display order. */
export async function getCatalog(): Promise<Catalog> {
  if (!isSupabaseConfigured) return staticCatalog();
  const client = requireSupabase();

  // RLS already limits guests to active rows; the filter keeps staff sessions consistent with that.
  const [servicesResult, itemsResult] = await Promise.all([
    client.from('services').select('*').eq('is_active', true).order('sort_order'),
    client.from('service_package_items').select('package_id, service_id, sort_order'),
  ]);
  if (servicesResult.error) throw servicesResult.error;
  if (itemsResult.error) throw itemsResult.error;

  const rows = servicesResult.data as ServiceRow[];
  const media = await fetchMediaUrls(rows.map((row) => row.image_media_id));
  return mapCatalog(rows, itemsResult.data as PackageItemRow[], media);
}

export interface DispatchZone {
  id: string;
  key: string;
  name: string;
  /** Travel fee in minor units. */
  feeMinor: number;
  formattedFee: string;
}

export interface DispatchZoneRow {
  id: string;
  key: string;
  name: string;
  fee_minor: number;
}

export function mapDispatchZone(row: DispatchZoneRow, currency = 'NGN'): DispatchZone {
  const feeMinor = Number(row.fee_minor);
  return { id: row.id, key: row.key, name: row.name, feeMinor, formattedFee: formatMoney(feeMinor, currency) };
}

/** Active travel-fee zones for mobile appointments, in display order. Empty without Supabase. */
export async function getDispatchZones(): Promise<DispatchZone[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await requireSupabase()
    .from('dispatch_zones')
    .select('id, key, name, fee_minor')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return (data as DispatchZoneRow[]).map((row) => mapDispatchZone(row));
}

/** Which therapists offer which services (therapist id -> service ids). Empty without Supabase. */
export async function getTherapistServiceLinks(): Promise<Map<string, Set<string>>> {
  const links = new Map<string, Set<string>>();
  if (!isSupabaseConfigured) return links;
  const { data, error } = await requireSupabase().from('therapist_services').select('therapist_id, service_id');
  if (error) throw error;
  for (const row of data as { therapist_id: string; service_id: string }[]) {
    if (!links.has(row.therapist_id)) links.set(row.therapist_id, new Set());
    links.get(row.therapist_id)!.add(row.service_id);
  }
  return links;
}

/** Active therapists, in display order. */
export async function getTherapists(): Promise<CatalogTherapist[]> {
  if (!isSupabaseConfigured) {
    return therapistsData.map(({ rating: _rating, ...t }) => ({ ...t, dbId: null }));
  }
  const { data, error } = await requireSupabase()
    .from('therapists')
    .select('id, display_name, title, specialty, bio, photo_url, photo_media_id')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;

  const rows = data as TherapistRow[];
  const media = await fetchMediaUrls(rows.map((row) => row.photo_media_id));
  return rows.map((row) => mapTherapist(row, media));
}
