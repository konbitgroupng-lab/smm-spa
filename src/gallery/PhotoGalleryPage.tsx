import { ArrowLeft, CalendarCheck, Expand } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { focusRing } from '../booking/components/ui';
import type { GalleryItem } from '../data';
import PhotoLightbox from './PhotoLightbox';
import { PHOTO_CATEGORY_LABELS, photoAlt, photoPageUrl, type PhotoCategory } from './photoGallery';

// The Photo Gallery page (?view=photos, optionally &p=<photo id>): every
// published photo, filterable, each opening large with previous / next.

type Filter = 'all' | PhotoCategory;

const FILTERS: { id: Filter; label: string; short: string }[] = [
  { id: 'all', label: 'All photos', short: 'All' },
  { id: 'sanctuary', label: PHOTO_CATEGORY_LABELS.sanctuary, short: 'Sanctuary' },
  { id: 'treatments', label: PHOTO_CATEGORY_LABELS.treatments, short: 'Therapies' },
  { id: 'therapy', label: PHOTO_CATEGORY_LABELS.therapy, short: 'Oils' },
];

export default function PhotoGalleryPage({ gallery, photoId = null }: { gallery: GalleryItem[]; photoId?: string | null }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  // A photo asked for in the address opens once it is known: the owner's
  // photos arrive from the database a moment after the page appears.
  const wanted = useRef(photoId);

  useEffect(() => {
    document.title = 'Photo Gallery | SMM (Sweet Mobile Massage and Spa)';
  }, []);

  useEffect(() => {
    if (wanted.current && gallery.some((item) => item.id === wanted.current)) {
      setOpenId(wanted.current);
      wanted.current = null;
    }
  }, [gallery]);

  const countFor = (f: Filter) => (f === 'all' ? gallery.length : gallery.filter((item) => item.category === f).length);
  const visible = filter === 'all' ? gallery : gallery.filter((item) => item.category === filter);
  const openIndex = openId ? visible.findIndex((item) => item.id === openId) : -1;

  function open(id: string | null) {
    setOpenId(id);
    window.history.replaceState(null, '', photoPageUrl(id ?? undefined));
  }

  return (
    <div className="min-h-screen bg-spa-cream text-spa-charcoal">
      <header className="bg-spa-charcoal">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <a href="/" className={`shrink-0 rounded ${focusRing}`}>
            <img src="/assets/images/smm_logo_cropped.png" alt="SMM (Sweet Mobile Massage and Spa) — back to the website" className="h-12 w-auto sm:h-14" />
          </a>
          <nav aria-label="Photo gallery" className="flex items-center gap-2 sm:gap-5">
            <a href="/#gallery" className={`hidden min-h-11 items-center gap-1.5 rounded px-2 text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold sm:inline-flex ${focusRing}`}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to website
            </a>
            <a href="/#booking" className={`inline-flex min-h-11 items-center gap-2 rounded bg-spa-gold px-4 text-xs font-bold uppercase tracking-widest text-spa-charcoal hover:bg-white sm:px-5 ${focusRing}`}>
              <CalendarCheck className="h-4 w-4" aria-hidden="true" />
              Book now
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-14 sm:px-6 sm:pt-20">
        <div className="mx-auto max-w-2xl space-y-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-spa-gold-dark">Tranquility Captured</p>
          <h1 className="font-serif text-4xl text-spa-charcoal md:text-6xl">
            <span className="italic">Sanctuary</span> Gallery
          </h1>
          <div className="mx-auto h-px w-12 bg-spa-gold" aria-hidden="true" />
          <p className="text-sm font-light text-spa-clay-text sm:text-base">
            A peaceful visual journey through our boutique treatment rooms, therapeutic hot stone arrangements, and organic aromatherapy rituals.
          </p>
        </div>

        <div className="mt-12 flex justify-center border-b border-spa-taupe">
          <div className="-mb-px flex max-w-full gap-4 overflow-x-auto px-1 sm:gap-10" role="group" aria-label="Filter photos">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={active}
                  aria-label={`${f.label} (${countFor(f.id)})`}
                  className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 pb-3 pt-2 text-xs font-semibold uppercase tracking-wider transition-colors sm:tracking-widest ${focusRing} ${
                    active ? 'border-spa-gold-dark text-spa-charcoal' : 'border-transparent text-spa-clay-text hover:text-spa-charcoal'
                  }`}
                >
                  <span className="sm:hidden">{f.short}</span>
                  <span className="hidden sm:inline">{f.label}</span>
                  <span className="ml-1.5 font-normal text-spa-clay-text">{countFor(f.id)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <section aria-labelledby="photos-heading" className="mt-10">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 id="photos-heading" className="text-xs font-bold uppercase tracking-widest text-spa-charcoal">
              {filter === 'all' ? 'All photos' : PHOTO_CATEGORY_LABELS[filter]}
            </h2>
            <p className="text-xs text-spa-clay-text">{visible.length} {visible.length === 1 ? 'photo' : 'photos'}</p>
          </div>

          {visible.length === 0 ? (
            <p className="rounded border border-spa-taupe bg-white px-6 py-12 text-center text-sm text-spa-clay-text">
              No photos in this group yet.{' '}
              <button type="button" onClick={() => setFilter('all')} className={`font-semibold text-spa-charcoal underline underline-offset-4 ${focusRing}`}>
                Show all photos
              </button>
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3">
              {visible.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => open(item.id)}
                    aria-label={`Open photo: ${item.title}`}
                    className={`group block w-full overflow-hidden rounded border border-spa-taupe bg-white p-1.5 text-left shadow-sm transition-shadow duration-300 hover:shadow-2xl sm:p-2 ${focusRing}`}
                  >
                    <span className="relative block aspect-[4/5] overflow-hidden rounded-sm sm:aspect-[4/3]">
                      <img
                        src={item.imageUrl}
                        alt={photoAlt(item)}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover brightness-95 transition-transform duration-700 group-hover:scale-105"
                      />
                      <span className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-spa-charcoal/55 text-white backdrop-blur-sm transition-colors group-hover:bg-spa-gold group-hover:text-spa-charcoal" aria-hidden="true">
                        <Expand className="h-4 w-4" />
                      </span>
                    </span>
                    <span className="flex flex-col gap-0.5 px-1 pb-1 pt-2 sm:pb-2 sm:pt-4">
                      <span className="font-serif text-sm font-medium leading-snug text-spa-charcoal sm:text-base">{item.title}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-spa-gold-dark">{PHOTO_CATEGORY_LABELS[item.category]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-14 text-center">
          <a href="/#booking" className={`inline-flex min-h-11 items-center gap-2 rounded bg-spa-charcoal px-7 py-3 text-xs font-bold uppercase tracking-widest text-spa-cream transition-colors hover:bg-spa-gold hover:text-spa-charcoal ${focusRing}`}>
            <CalendarCheck className="h-4 w-4" aria-hidden="true" />
            Book your session
          </a>
        </div>
      </main>

      {openIndex >= 0 && (
        <PhotoLightbox
          items={visible}
          index={openIndex}
          onChange={(i) => open(visible[i].id)}
          onClose={() => open(null)}
        />
      )}
    </div>
  );
}
