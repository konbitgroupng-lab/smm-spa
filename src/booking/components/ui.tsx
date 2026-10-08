import { AlertCircle, Loader2, X } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { messageFor } from '../messages';

// Small building blocks in the site's existing style (charcoal/gold buttons,
// uppercase tracked labels, taupe borders, Playfair headings). Every control is
// at least 44px tall and shows a visible focus ring.

export const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spa-gold-dark focus-visible:ring-offset-2';

/** Step title. Receives focus when the step opens, so screen readers announce it. */
export const StepHeading = forwardRef<HTMLHeadingElement, { children: ReactNode; hint?: ReactNode }>(function StepHeading({ children, hint }, ref) {
  return (
    <div className="space-y-1">
      {/* scroll-mt keeps the heading clear of the site's fixed header when focus brings it into view */}
      <h3 ref={ref} tabIndex={-1} className="scroll-mt-32 font-serif text-2xl text-spa-charcoal focus:outline-none">
        {children}
      </h3>
      {hint && <p className="text-sm text-spa-clay-text">{hint}</p>}
    </div>
  );
});

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean };

export function PrimaryButton({ busy, children, className = '', disabled, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded bg-spa-charcoal px-6 py-3 text-xs font-bold uppercase tracking-widest text-spa-cream transition-colors hover:bg-spa-gold hover:text-spa-charcoal disabled:cursor-not-allowed disabled:bg-spa-taupe disabled:text-spa-clay-text ${focusRing} ${className}`}
    >
      {busy && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function SecondaryButton({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded border border-spa-taupe bg-white px-5 py-3 text-xs font-semibold uppercase tracking-widest text-spa-charcoal transition-colors hover:border-spa-gold-dark disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${className}`}
    >
      {children}
    </button>
  );
}

/** Uppercase field label, as used across the site's forms. */
export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-bold uppercase tracking-widest text-spa-charcoal">
      {children}
    </label>
  );
}

export const inputClass = `w-full min-h-11 rounded border border-spa-taupe bg-white p-3 text-base text-spa-charcoal placeholder:text-spa-clay/70 focus:border-spa-gold-dark ${focusRing} aria-[invalid=true]:border-spa-berry sm:text-sm`;

/** Error or notice for the whole step. Announced immediately by screen readers. */
export function ErrorBanner({ code, onDismiss }: { code: string | null; onDismiss?: () => void }) {
  if (!code) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded border border-spa-berry/30 bg-spa-blush/30 p-4 text-sm text-spa-berry">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="flex-1">{messageFor(code)}</p>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss message" className={`-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded ${focusRing}`}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * A selectable card backed by a real radio input, so arrow keys move between
 * options and screen readers announce "1 of 4, selected".
 */
export function ChoiceCard({
  name,
  value,
  checked,
  onChange,
  title,
  detail,
  aside,
  disabled,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  title: ReactNode;
  detail?: ReactNode;
  aside?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={`relative flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-spa-gold-dark has-[:focus-visible]:ring-offset-2 ${
        checked ? 'border-spa-gold-dark bg-spa-cream shadow-md' : 'border-spa-taupe bg-white hover:border-spa-gold-dark/60'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange(value)} className="sr-only" />
      <span className="min-w-0 space-y-1">
        <span className="block font-serif text-base font-semibold text-spa-charcoal">{title}</span>
        {detail && <span className="block text-xs text-spa-clay-text">{detail}</span>}
      </span>
      {aside && <span className="shrink-0 font-serif text-sm font-semibold text-spa-gold-dark">{aside}</span>}
      {checked && <span className="sr-only">(selected)</span>}
    </label>
  );
}

/** Visually hidden live region for announcements that are not errors. */
export function LiveAnnouncement({ message }: { message: string }) {
  return (
    <p aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </p>
  );
}
