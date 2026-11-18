import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { GalleryItem } from '../data';
import { PHOTO_CATEGORY_LABELS, photoAlt } from './photoGallery';

// One photo shown large over the page, with previous / next. A modal dialog:
// keyboard focus stays inside it, Escape closes it, the arrow keys move between
// photos, and focus goes back to the photo the visitor opened.

const button =
  'flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-spa-gold hover:text-spa-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spa-gold focus-visible:ring-offset-2 focus-visible:ring-offset-spa-charcoal';

export default function PhotoLightbox({ items, index, onChange, onClose }: {
  items: GalleryItem[];
  index: number;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);
  const item = items[index];
  const many = items.length > 1;
  const go = (step: number) => onChange((index + step + items.length) % items.length);

  // Focus the close button on opening; give focus back on closing. The page
  // behind does not scroll while the photo is open.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (many && e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    } else if (many && e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'Tab') {
      // Keep keyboard focus inside the dialog.
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button') ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  if (!item) return null;
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-lightbox-title"
      onKeyDown={onKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        const end = e.changedTouches[0]?.clientX;
        if (!many || start == null || end == null || Math.abs(end - start) < 50) return;
        go(end < start ? 1 : -1);
      }}
      // Above the WhatsApp button and booking shortcut (z-50).
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-spa-charcoal/95 p-4 backdrop-blur-md sm:p-8"
    >
      <button ref={closeRef} type="button" onClick={onClose} aria-label="Close photo" className={`absolute right-4 top-4 sm:right-6 sm:top-6 ${button}`}>
        <X className="h-6 w-6" aria-hidden="true" />
      </button>

      <figure className="flex w-full max-w-4xl flex-col items-center gap-4 text-center">
        <img
          key={item.id}
          src={item.imageUrl}
          alt={photoAlt(item)}
          className="max-h-[70vh] w-auto rounded border border-white/10 object-contain shadow-2xl"
          referrerPolicy="no-referrer"
        />
        <figcaption className="space-y-1">
          <h2 id="photo-lightbox-title" className="font-serif text-2xl font-medium text-white">{item.title}</h2>
          <p className="text-xs font-bold uppercase tracking-widest text-spa-gold">
            {PHOTO_CATEGORY_LABELS[item.category]}
            {many && <span className="ml-3 font-normal text-spa-linen/80">{index + 1} of {items.length}</span>}
          </p>
        </figcaption>
      </figure>

      {many && (
        <div className="mt-6 flex items-center gap-6 sm:mt-0">
          <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className={`sm:absolute sm:left-6 sm:top-1/2 sm:-translate-y-1/2 ${button}`}>
            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next photo" className={`sm:absolute sm:right-6 sm:top-1/2 sm:-translate-y-1/2 ${button}`}>
            <ChevronRight className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
