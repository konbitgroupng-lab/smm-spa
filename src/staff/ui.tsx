import { useId, type ReactNode } from 'react';

// Small building blocks shared by the staff screens.

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-spa-cream">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-spa-taupe p-6 sm:p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-spa-clay mb-2">SMM staff</p>
        <h1 className="font-serif text-2xl text-spa-charcoal mb-6">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function Field({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  required = true,
  hint,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-sm font-medium text-spa-charcoal mb-1">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-spa-taupe px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-spa-gold"
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-spa-clay">
          {hint}
        </p>
      )}
    </div>
  );
}

export function PrimaryButton({ children, busy, type = 'submit', onClick }: {
  children: ReactNode;
  busy?: boolean;
  type?: 'submit' | 'button';
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      className="w-full rounded-lg bg-spa-charcoal text-white py-2.5 font-medium hover:bg-black disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-sm text-spa-berry underline underline-offset-2 hover:text-spa-charcoal">
      {children}
    </button>
  );
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="status" className="mb-4 rounded-lg bg-spa-linen border border-spa-taupe px-3 py-2 text-sm text-spa-charcoal">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Operational screens (Phase 5b)

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
      <h1 tabIndex={-1} className="font-serif text-2xl focus:outline-none min-w-0 [overflow-wrap:anywhere]">{children}</h1>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} id={id} className="bg-white rounded-xl border border-spa-taupe p-4 sm:p-5">
      <h2 id={headingId} className="font-medium text-base mb-3">{title}</h2>
      {children}
    </section>
  );
}

const BUTTON_TONES = {
  primary: 'bg-spa-charcoal text-white hover:bg-black border border-spa-charcoal',
  secondary: 'bg-white text-spa-charcoal border border-spa-taupe hover:border-spa-charcoal',
  danger: 'bg-red-800 text-white hover:bg-red-900 border border-red-800',
} as const;

export function Button({ children, tone = 'secondary', type = 'button', busy, disabled, onClick, className = '', label }: {
  children: ReactNode;
  tone?: keyof typeof BUTTON_TONES;
  type?: 'button' | 'submit';
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  /** Accessible name, when the visible content is only a symbol. */
  label?: string;
}) {
  return (
    <button
      type={type}
      aria-label={label}
      onClick={onClick}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      className={`rounded-lg px-4 py-2 text-sm font-medium min-h-[40px] disabled:opacity-60 ${BUTTON_TONES[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

export function LinkAsButton({ href, children, tone = 'secondary' }: { href: string; children: ReactNode; tone?: keyof typeof BUTTON_TONES }) {
  return (
    <a href={href} className={`inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium min-h-[40px] ${BUTTON_TONES[tone]}`}>
      {children}
    </a>
  );
}

export function SelectField({ label, value, onChange, options, required = true, hint }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-sm font-medium mb-1">{label}</label>
      <select
        id={id}
        value={value}
        required={required}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-spa-taupe bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-spa-gold"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-spa-clay">{hint}</p>}
    </div>
  );
}

export function TextAreaField({ label, value, onChange, required = false, hint, rows = 3, maxLength }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
  rows?: number;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-sm font-medium mb-1">{label}</label>
      <textarea
        id={id}
        value={value}
        rows={rows}
        required={required}
        maxLength={maxLength}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-spa-taupe px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-spa-gold"
      />
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-spa-clay">{hint}</p>}
    </div>
  );
}

export function CheckboxField({ label, checked, onChange, hint }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="mb-4 flex items-start gap-2">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined} className="mt-1 h-4 w-4" />
      <div>
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {hint && <p id={`${id}-hint`} className="text-xs text-spa-clay">{hint}</p>}
      </div>
    </div>
  );
}

/** A group of mutually exclusive choices, shown as buttons. */
export function ChoiceGroup<T extends string>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  const id = useId();
  return (
    <fieldset className="mb-4">
      <legend id={id} className="block text-sm font-medium mb-1">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value}
            className={`cursor-pointer rounded-lg border px-3 py-2 text-sm min-h-[40px] flex items-center gap-2 ${value === o.value ? 'border-spa-charcoal bg-spa-linen font-medium' : 'border-spa-taupe bg-white'}`}>
            <input type="radio" name={id} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="h-4 w-4" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Badge({ children, tone = 'bg-spa-linen text-spa-charcoal' }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{children}</span>;
}

/** Loading and error states around a screen's content; `ready` once its data has arrived. */
export function LoadState({ ready, error, onRetry, children }: {
  ready: boolean;
  error: string;
  onRetry: () => void;
  children: () => ReactNode;
}) {
  if (error) {
    return (
      <div>
        <ErrorMessage>{error}</ErrorMessage>
        <Button onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  if (!ready) return <p role="status" className="text-sm text-spa-clay">Loading…</p>;
  return <>{children()}</>;
}