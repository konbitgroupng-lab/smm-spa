import { FlaskConical } from 'lucide-react';

/** Shown wherever a simulated payment is involved, so nobody mistakes it for a real one. */
export default function DemoPaymentNotice({ className = '' }: { className?: string }) {
  return (
    <div
      role="note"
      className={`flex items-start gap-3 rounded-lg border-2 border-dashed border-spa-terracotta bg-spa-blush/40 px-4 py-3 text-spa-charcoal ${className}`}
    >
      <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-spa-terracotta" aria-hidden="true" />
      <p className="text-sm">
        <strong className="font-bold uppercase tracking-wide">Demo Payment — No real money will be charged.</strong>{' '}
        This checkout is simulated for development. No card details are collected.
      </p>
    </div>
  );
}
