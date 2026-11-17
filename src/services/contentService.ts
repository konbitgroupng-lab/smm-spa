import { faqsData, galleryData, type FAQItem, type GalleryItem, type Testimonial } from '../data';
import { isSupabaseConfigured, requireSupabase, storagePublicUrl } from '../lib/supabase';

// Website content reads (CMS). Guests read only published rows and only the
// columns the site shows (Row Level Security and column grants decide; this
// file only asks). Without Supabase configured, the built-in content is used.
// Plain text only: nothing here is ever rendered as HTML.

export async function getFaqs(): Promise<FAQItem[]> {
  if (!isSupabaseConfigured) return faqsData;
  const { data, error } = await requireSupabase()
    .from('faqs')
    .select('id, question, answer')
    .eq('is_published', true)
    .order('sort_order');
  if (error) throw error;
  return (data as { id: string; question: string; answer: string[] }[]).map((row) => ({
    id: row.id,
    question: row.question,
    answer: row.answer.length === 1 ? row.answer[0] : row.answer,
  }));
}

/** Published guest reviews. There is no built-in fallback: reviews are never invented. */
export async function getTestimonials(): Promise<Testimonial[]> {
  if (!isSupabaseConfigured) return [];
  const client = requireSupabase();
  const { data, error } = await client
    .from('testimonials')
    .select('id, author_name, author_location, body, rating, service_id')
    .eq('is_published', true)
    .order('sort_order');
  if (error) throw error;
  const rows = data as { id: string; author_name: string; author_location: string | null; body: string; rating: number; service_id: string | null }[];
  const serviceIds = [...new Set(rows.map((r) => r.service_id).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (serviceIds.length) {
    const services = await client.from('services').select('id, name').in('id', serviceIds);
    for (const s of (services.data ?? []) as { id: string; name: string }[]) names.set(s.id, s.name);
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.author_name,
    location: row.author_location ?? '',
    text: row.body,
    rating: row.rating,
    serviceName: (row.service_id && names.get(row.service_id)) || '',
  }));
}

export async function getGallery(): Promise<GalleryItem[]> {
  if (!isSupabaseConfigured) return galleryData;
  const client = requireSupabase();
  const { data, error } = await client
    .from('gallery_items')
    .select('id, title, category, image_url, image_media_id')
    .eq('is_published', true)
    .order('sort_order');
  if (error) throw error;
  const rows = data as { id: string; title: string; category: string; image_url: string | null; image_media_id: string | null }[];
  const mediaIds = rows.map((r) => r.image_media_id).filter((id): id is string => !!id);
  const media = new Map<string, { bucket: string; path: string; alt_text: string }>();
  if (mediaIds.length) {
    const found = await client.from('media_assets').select('id, bucket, path, alt_text').in('id', mediaIds);
    for (const m of (found.data ?? []) as { id: string; bucket: string; path: string; alt_text: string }[]) media.set(m.id, m);
  }
  return rows.flatMap((row) => {
    const file = row.image_media_id ? media.get(row.image_media_id) : undefined;
    const imageUrl = file ? storagePublicUrl(file.bucket, file.path) : row.image_url;
    if (!imageUrl) return [];
    return [{
      id: row.id,
      title: row.title,
      category: row.category as GalleryItem['category'],
      imageUrl,
      ...(file?.alt_text ? { altText: file.alt_text } : {}),
    }];
  });
}

export interface Announcement {
  id: string;
  kind: 'announcement' | 'promotion';
  title: string;
  body: string;
}

/** Published announcements whose dates include now (the database applies the dates). */
export async function getAnnouncements(): Promise<Announcement[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await requireSupabase()
    .from('announcements')
    .select('id, kind, title, body, starts_at')
    .eq('is_published', true)
    .order('starts_at', { ascending: false });
  if (error) throw error;
  return (data as { id: string; kind: Announcement['kind']; title: string; body: string | null }[]).map((a) => ({
    id: a.id, kind: a.kind, title: a.title, body: a.body ?? '',
  }));
}

/** A keyed content block (e.g. "contact", "homepage.hero"), or null if it is not published. */
export async function getSiteContent<T = Record<string, unknown>>(key: string): Promise<T | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().from('site_content').select('value').eq('key', key).eq('is_published', true);
  if (error) throw error;
  return ((data as { value: T }[])[0]?.value as T) ?? null;
}

export interface BusinessSettings {
  businessName: string;
  timezone: string;
  currency: string;
  onlinePaymentEnabled: boolean;
  paymentMode: 'deposit' | 'full';
  depositPercent: number;
  holdMinutes: number;
  /** Bookings may be made this many days ahead (local calendar days). */
  maxAdvanceDays: number;
  /** Minimum notice before a start time. */
  minLeadMinutes: number;
  /** Start times are multiples of this, from local midnight. */
  slotIntervalMinutes: number;
}

/** Non-sensitive business configuration. Payment secrets are never stored here. */
export async function getBusinessSettings(): Promise<BusinessSettings | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().from('business_settings').select('*').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    businessName: data.business_name,
    timezone: data.timezone,
    currency: data.currency,
    onlinePaymentEnabled: data.online_payment_enabled,
    paymentMode: data.payment_mode,
    depositPercent: data.deposit_percent,
    holdMinutes: data.hold_minutes,
    maxAdvanceDays: data.max_advance_days,
    minLeadMinutes: data.min_lead_minutes,
    slotIntervalMinutes: data.slot_interval_minutes,
  };
}
