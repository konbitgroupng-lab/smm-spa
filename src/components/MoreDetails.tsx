import { Check, ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';

/**
 * A short list (a treatment's benefits, what a package includes) folded behind
 * a small button, so the cards stay compact. The list is in the page for
 * search engines and screen readers either way; it is only hidden from view.
 */
export default function MoreDetails({ label, items }: { label: string; items: string[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!items.length) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex min-h-11 items-center gap-1.5 rounded text-xs font-semibold uppercase tracking-wider text-spa-charcoal underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spa-gold-dark"
      >
        {open ? `Hide ${label.toLowerCase()}` : `See ${label.toLowerCase()}`}
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      <ul id={id} hidden={!open} aria-label={label} className="mt-2 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2.5 text-xs text-spa-clay-text">
            <Check className="w-3.5 h-3.5 text-spa-gold-dark mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
