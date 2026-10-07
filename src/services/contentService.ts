import { faqsData, galleryData, testimonialsData, type FAQItem, type GalleryItem, type Testimonial } from '../data';
import { isSupabaseConfigured, requireSupabase, storagePublicUrl } from '../lib/supabase';

// Website content reads (CMS). Same contract as catalogService: existing
// component shapes, static fallback when Supabase is not configured.

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

export async function getTestimonials(): Promise<Testimonial[]> {
  if (!isSupabaseConfigured) return testimonialsData;
  const { data, error } = await requireSupabase()
    .from('testimonials')
    .select('id, author_name, author_location, body, rating, service:services(name)')
    .eq('is_published', true)
    .order('sort_order');
  if (error) throw error;
  return (data as any[]).map((row) => ({
    id: row.id,
    name: row.author_name,
    location: row.author_location ?? '',
    text: row.body,
    rating: row.rating,
    serviceName: row.service?.name ?? '',
  }));
}

export async function getGallery(): Promise<GalleryItem[]> {
  if (!isSupabaseConfigured) return galleryData;
  const { data, error } = await requireSupabase()
    .from('gallery_items')
    .select('id, title, category, image_url, media:media_assets(bucket, path)')
    .eq('is_published', true)
    .order('sort_order');
  if (error) throw error;
  return (data as any[]).map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    imageUrl: row.media ? storagePublicUrl(row.media.bucket, row.media.path) : row.image_url,
  }));
}

/** A keyed content block (e.g. "contact", "homepage.hero"), or null if it is not published. */
export async function getSiteContent<T = Record<string, unknown>>(key: string): Promise<T | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await requireSupabase().from('site_content').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return (data?.value as T) ?? null;
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
