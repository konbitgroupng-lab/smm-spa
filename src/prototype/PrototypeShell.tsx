import type { ReactNode } from 'react';

/** Plain page frame for the development prototype pages (not the public site design). */
export default function PrototypeShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-spa-cream px-4 py-8 text-spa-charcoal sm:py-12">
      <div className="mx-auto max-w-xl">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-spa-terracotta">Development prototype</p>
        <h1 className="font-serif text-3xl">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-spa-charcoal/70">{subtitle}</p>}
        <div className="mt-6 space-y-5">{children}</div>
        <p className="mt-10 text-xs text-spa-charcoal/60">
          <a className="underline" href="/">Back to the website</a>
        </p>
      </div>
    </div>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return <section className="rounded-lg border border-spa-taupe bg-white p-5 shadow-sm">{children}</section>;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  type?: 'button' | 'submit';
}) {
  const styles = {
    primary: 'bg-spa-charcoal text-white hover:bg-spa-gold-dark',
    secondary: 'border border-spa-charcoal text-spa-charcoal hover:bg-spa-linen',
    danger: 'border border-spa-terracotta text-spa-terracotta hover:bg-spa-blush/40',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-full px-5 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

export function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-spa-blush/50 px-4 py-3 text-sm text-spa-berry">
      {message}
    </p>
  );
}

/** "Mon 12 Oct, 10:00" in the business timezone. */
export function formatSlot(iso: string): string {
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

const MESSAGES: Record<string, string> = {
  slot_unavailable: 'That time has just been taken. Please choose another.',
  hold_expired: 'Your reserved time ran out. Please choose a time again.',
  invalid_customer: 'Please check your name, email and phone number.',
  customer_required: 'Please enter your details first.',
  address_required: 'Please enter the address for a mobile appointment.',
  payments_disabled: 'Online payment is switched off.',
  demo_payments_disabled: 'Demo payments are not enabled for this database.',
  gateway_unavailable: 'The payment provider could not be reached. Please try again.',
  rate_limited: 'Too many attempts. Please wait a few minutes.',
  payment_not_found: 'We could not find that payment.',
  transaction_not_found: 'This demo checkout link is not valid.',
  not_available: 'Demo checkout is not available: the server is not using the demo payment provider.',
};

export function messageFor(err: unknown): string {
  const code = (err as { code?: string })?.code;
  return (code && MESSAGES[code]) || 'Something went wrong. Please try again.';
}
