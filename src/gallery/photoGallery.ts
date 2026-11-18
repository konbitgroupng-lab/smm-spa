import type { GalleryItem } from '../data';

// Shared by the homepage's Sanctuary Gallery section and the Photo Gallery page.

export type PhotoCategory = GalleryItem['category'];

export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
  sanctuary: 'Boutique Sanctuary',
  treatments: 'Therapies',
  therapy: 'Botanicals & Oils',
};

/** How many photos the homepage shows before "View the full gallery". */
export const FEATURED_PHOTO_COUNT = 3;

/** The Photo Gallery page, optionally opened on one photo. */
export const photoPageUrl = (photoId?: string) =>
  photoId ? `/?view=photos&p=${encodeURIComponent(photoId)}` : '/?view=photos';

/** The description a screen reader hears for a photo. */
export const photoAlt = (item: GalleryItem) => item.altText || item.title;
