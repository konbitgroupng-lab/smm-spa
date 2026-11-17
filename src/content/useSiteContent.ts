import { useEffect, useState } from 'react';
import { setContactDetails, type SavedContact } from '../config/business';
import { faqsData, galleryData, type FAQItem, type GalleryItem, type Testimonial } from '../data';
import { isSupabaseConfigured } from '../lib/env';
import type { Announcement } from '../services/contentService';

/** What the public site shows that the owner edits in the staff app (Website). */
export interface SiteContent {
  faqs: FAQItem[];
  gallery: GalleryItem[];
  /** Real, published reviews only; empty hides the reviews section. */
  testimonials: Testimonial[];
  announcements: Announcement[];
  /** The owner's homepage heading, when they have chosen to show one. */
  hero: { heading: string; subheading: string | null } | null;
}

/** Shown first, and kept whenever the database cannot be reached. Never any reviews. */
export const BUILT_IN_CONTENT: SiteContent = {
  faqs: faqsData,
  gallery: galleryData,
  testimonials: [],
  announcements: [],
  hero: null,
};

export interface LoadedContent {
  faqs: FAQItem[] | null;
  gallery: GalleryItem[] | null;
  testimonials: Testimonial[] | null;
  announcements: Announcement[] | null;
  hero: { heading?: string | null; subheading?: string | null } | null;
  contact: SavedContact | null;
}

/** Each part separately: one that fails to load keeps its built-in content. */
async function loadFromDatabase(): Promise<LoadedContent> {
  const s = await import('../services/contentService');
  const settle = <T,>(p: Promise<T>) => p.then((v) => v, () => null);
  const [faqs, gallery, testimonials, announcements, hero, contact] = await Promise.all([
    settle(s.getFaqs()),
    settle(s.getGallery()),
    settle(s.getTestimonials()),
    settle(s.getAnnouncements()),
    settle(s.getSiteContent<LoadedContent['hero'] & object>('homepage.hero')),
    settle(s.getSiteContent<SavedContact>('contact')),
  ]);
  return { faqs, gallery, testimonials, announcements, hero, contact };
}

/** Combines what loaded with the built-in content. */
export function mergeContent(loaded: LoadedContent): SiteContent {
  const heading = loaded.hero?.heading?.trim();
  return {
    // An empty list means nothing is published yet: the built-in questions and pictures stay.
    faqs: loaded.faqs?.length ? loaded.faqs : BUILT_IN_CONTENT.faqs,
    gallery: loaded.gallery?.length ? loaded.gallery : BUILT_IN_CONTENT.gallery,
    testimonials: loaded.testimonials ?? [],
    announcements: loaded.announcements ?? [],
    hero: heading ? { heading, subheading: loaded.hero?.subheading?.trim() || null } : null,
  };
}

/**
 * The site renders the built-in content at once, then switches to the
 * owner's content when it arrives. Contact details are applied to the shared
 * config (phone, email, address and the WhatsApp links on every page).
 */
export function useSiteContent(load: () => Promise<LoadedContent> = loadFromDatabase, configured = isSupabaseConfigured): SiteContent {
  const [content, setContent] = useState<SiteContent>(BUILT_IN_CONTENT);
  useEffect(() => {
    if (!configured) return;
    let current = true;
    load()
      .then((loaded) => {
        if (!current) return;
        setContactDetails(loaded.contact);
        setContent(mergeContent(loaded));
      })
      .catch(() => undefined); // keep the built-in content
    return () => {
      current = false;
    };
  }, [load, configured]);
  return content;
}
