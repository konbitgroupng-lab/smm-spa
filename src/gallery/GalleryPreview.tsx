import { ArrowRight, Expand } from 'lucide-react';
import Eyebrow from '../components/Eyebrow';
import { focusRing } from '../booking/components/ui';
import type { GalleryItem } from '../data';
import { FEATURED_PHOTO_COUNT, PHOTO_CATEGORY_LABELS, photoAlt, photoPageUrl } from './photoGallery';

// The homepage's "Sanctuary Gallery" section: the first three photos (in the
// owner's order) leading to the full Photo Gallery page, like the Video Gallery.

export default function GalleryPreview({ gallery }: { gallery: GalleryItem[] }) {
  const featured = gallery.slice(0, FEATURED_PHOTO_COUNT);
  return (
    <section id="gallery" className="py-24 bg-spa-linen border-t border-spa-taupe relative">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto space-y-4 mb-14">
          <Eyebrow>Tranquility Captured</Eyebrow>
          <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal"><span className="italic">Sanctuary</span> Gallery</h2>
          <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
          <p className="text-spa-clay-text text-sm font-light mt-4">
            A peaceful visual journey through our boutique treatment rooms, therapeutic hot stone arrangements, and organic aromatherapy rituals.
          </p>
        </div>

        {/* Phones: the first photo full width, the next two side by side. Larger screens: three in a row. */}
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-6 lg:gap-8">
          {featured.map((item, i) => (
            <li key={item.id} className={i === 0 ? 'col-span-2 sm:col-span-1' : undefined}>
              <a
                href={photoPageUrl(item.id)}
                aria-label={`View photo: ${item.title}`}
                className={`group block h-full overflow-hidden rounded border border-spa-taupe bg-white p-1.5 sm:p-2 shadow-sm transition-shadow duration-300 hover:shadow-2xl ${focusRing}`}
              >
                <div className={`relative overflow-hidden rounded-sm ${i === 0 ? 'aspect-[4/3]' : 'aspect-square'} sm:aspect-[4/5]`}>
                  <img
                    src={item.imageUrl}
                    alt={photoAlt(item)}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover brightness-95 transition-transform duration-700 group-hover:scale-105"
                  />
                  <span className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-spa-charcoal/55 text-white opacity-90 backdrop-blur-sm transition-colors group-hover:bg-spa-gold group-hover:text-spa-charcoal" aria-hidden="true">
                    <Expand className="h-4 w-4" />
                  </span>
                </div>
                <div className="px-1 pt-2 pb-1 sm:pt-4 sm:pb-2 flex flex-col gap-0.5">
                  <span className="font-serif text-sm sm:text-base text-spa-charcoal font-medium leading-snug">{item.title}</span>
                  <span className="text-[10px] uppercase tracking-wider text-spa-gold-dark font-bold">{PHOTO_CATEGORY_LABELS[item.category]}</span>
                </div>
              </a>
            </li>
          ))}
        </ul>

        <div className="mt-12 text-center">
          <a
            href={photoPageUrl()}
            className={`inline-flex min-h-11 items-center gap-2 rounded border border-spa-charcoal px-7 py-3 text-xs font-bold uppercase tracking-widest text-spa-charcoal transition-colors hover:bg-spa-charcoal hover:text-spa-cream ${focusRing}`}
          >
            View the full gallery{' '}
            <span>({gallery.length} {gallery.length === 1 ? 'photo' : 'photos'})</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
