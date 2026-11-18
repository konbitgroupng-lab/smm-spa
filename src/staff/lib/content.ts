// Website content as the staff app sees it (Phase 6b). Everything here is
// read and changed through the staff content functions, which check the
// caller's role and the record's version; nothing here decides who may edit.

export type ContentKind = 'faq' | 'testimonial' | 'gallery' | 'announcement';
export type MediaFolder = 'gallery' | 'services' | 'therapists' | 'site';

export interface ContentFaq {
  id: string;
  question: string;
  answer: string[];
  sortOrder: number;
  isPublished: boolean;
  updatedAt: string;
}

export interface ContentTestimonial {
  id: string;
  authorName: string;
  authorLocation: string | null;
  body: string;
  rating: number;
  serviceId: string | null;
  serviceName: string | null;
  sortOrder: number;
  isPublished: boolean;
  updatedAt: string;
}

export interface ContentGalleryItem {
  id: string;
  title: string;
  category: string;
  /** A picture shipped with the website (under /assets/), when no uploaded file is chosen. */
  imageUrl: string | null;
  imageMediaId: string | null;
  /** Where the picture can be shown from: the uploaded file, else imageUrl. */
  previewUrl: string | null;
  sortOrder: number;
  isPublished: boolean;
  updatedAt: string;
}

export interface ContentAnnouncement {
  id: string;
  kind: 'announcement' | 'promotion';
  title: string;
  body: string;
  startsAt: string | null;
  endsAt: string | null;
  isPublished: boolean;
  updatedAt: string;
}

export interface ContactDetails {
  address?: string | null;
  phone?: string | null;
  phone_secondary?: string | null;
  phone_third?: string | null;
  email?: string | null;
  whatsapp?: string | null;
}

export interface HeroText {
  heading?: string | null;
  subheading?: string | null;
}

export interface SiteBlock<T> {
  key: string;
  value: T | null;
  isPublished: boolean;
  /** Null until the block has been saved once. */
  updatedAt: string | null;
}

export interface MediaItem {
  id: string;
  path: string;
  url: string;
  altText: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
  /** How many gallery items, treatments and therapists use it. */
  uses: number;
}

export interface SiteContent {
  faqs: ContentFaq[];
  testimonials: ContentTestimonial[];
  gallery: ContentGalleryItem[];
  announcements: ContentAnnouncement[];
  contact: SiteBlock<ContactDetails>;
  hero: SiteBlock<HeroText>;
  media: MediaItem[];
}

export interface FaqInput { question: string; answer: string[] }
export interface TestimonialInput { authorName: string; authorLocation: string; body: string; rating: number; serviceId: string | null }
export interface GalleryInput { title: string; category: string; imageUrl: string | null; imageMediaId: string | null }
export interface AnnouncementInput { kind: 'announcement' | 'promotion'; title: string; body: string; startsAt: string | null; endsAt: string | null }

export interface ContentOps {
  content(): Promise<SiteContent>;
  saveFaq(id: string | null, version: string | null, input: FaqInput): Promise<{ id: string }>;
  saveTestimonial(id: string | null, version: string | null, input: TestimonialInput): Promise<{ id: string }>;
  saveGalleryItem(id: string | null, version: string | null, input: GalleryInput): Promise<{ id: string }>;
  saveAnnouncement(id: string | null, version: string | null, input: AnnouncementInput): Promise<{ id: string }>;
  saveContact(version: string | null, value: ContactDetails): Promise<void>;
  saveHero(version: string | null, value: HeroText, published: boolean): Promise<void>;
  setPublished(kind: ContentKind, id: string, published: boolean, version: string): Promise<void>;
  reorder(kind: Exclude<ContentKind, 'announcement'>, ids: string[]): Promise<void>;
  deleteContent(kind: ContentKind, id: string, reason: string, version: string): Promise<void>;
  uploadMedia(file: File, folder: MediaFolder, altText: string): Promise<{ id: string }>;
  updateMedia(id: string, version: string, altText: string): Promise<void>;
  removeMedia(id: string, reason: string, version: string): Promise<void>;
}

/** Public address of a file in the site-media bucket. */
export function mediaUrl(supabaseUrl: string, bucket: string, path: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/** The paragraphs of an answer: blank lines separate them. */
export const toParagraphs = (text: string) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
export const fromParagraphs = (paragraphs: string[]) => paragraphs.join('\n\n');
