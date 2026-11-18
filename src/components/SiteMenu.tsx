import { useEffect, useRef } from 'react';
import { Menu, X } from 'lucide-react';

export interface SiteMenuLink {
  href: string;
  label: string;
  emphasis?: boolean;
}

interface SiteMenuProps {
  links: SiteMenuLink[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PANEL_ID = 'site-menu-panel';

/**
 * The header's section links on phones, tablets and small laptops, where the
 * full row does not fit: a Menu button that drops the same links down under
 * the header. Closes on a link, Escape, a click outside, or a resize up to the
 * width where the full row shows (xl, 1280px).
 */
export default function SiteMenu({ links, open, onOpenChange }: SiteMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    const wide = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 1280px)') : null;
    const onWide = () => { if (wide?.matches) onOpenChange(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    wide?.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      wide?.removeEventListener('change', onWide);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="xl:hidden">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="w-11 h-11 flex items-center justify-center rounded border border-white/40 text-spa-linen hover:border-spa-gold hover:text-spa-gold transition-colors duration-200"
      >
        {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      <nav
        id={PANEL_ID}
        aria-label="Site sections"
        hidden={!open}
        className="absolute top-full left-0 right-0 bg-spa-charcoal/95 backdrop-blur-md border-t border-white/10 shadow-lg max-h-[calc(100vh-7rem)] overflow-y-auto"
      >
        <ul className="max-w-7xl mx-auto px-6 py-2 sm:grid sm:grid-cols-2 sm:gap-x-8">
          {links.map((link) => (
            <li key={link.href} className="border-b border-white/10 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
              <a
                href={link.href}
                onClick={() => onOpenChange(false)}
                className={`block py-3.5 text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold transition-colors duration-200 ${link.emphasis ? 'font-medium' : ''}`}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
