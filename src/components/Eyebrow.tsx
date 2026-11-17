import type { ReactNode } from 'react';

/**
 * The small upper-case label above a section heading ("Curated Therapy").
 *
 * On light backgrounds the brand's bright gold is too faint to read
 * (about 1.5:1), so the words are set in the dark bronze `spa-gold-dark`
 * (about 5.6:1 on cream) and the gold stays as a short decorative rule beside
 * them. On dark backgrounds the bright gold reads well and is kept.
 */
export const EYEBROW_TEXT = {
  light: 'text-spa-gold-dark',
  dark: 'text-spa-gold',
} as const;

export default function Eyebrow({ children, align = 'center', on = 'light' }: {
  children: ReactNode;
  align?: 'center' | 'start';
  on?: 'light' | 'dark';
}) {
  // On the narrowest phones the rules would push a long label onto two lines;
  // there the gold underline below the heading carries the accent instead.
  const rule = <span aria-hidden="true" className="hidden min-[380px]:block h-px w-4 sm:w-6 bg-spa-gold flex-shrink-0" />;
  return (
    <span className={`flex items-center gap-2 sm:gap-3 ${align === 'center' ? 'justify-center' : ''} ${EYEBROW_TEXT[on]} text-xs uppercase tracking-[0.3em] font-semibold`}>
      {rule}
      <span>{children}</span>
      {align === 'center' && rule}
    </span>
  );
}
