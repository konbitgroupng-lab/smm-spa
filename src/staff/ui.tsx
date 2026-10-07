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
