// Chooses which page to render from the query string.
//
//   ?view=booking-prototype                 booking flow prototype (development builds,
//                                           or VITE_ENABLE_BOOKING_PROTOTYPE=true)
//   ?view=demo-checkout&reference=...       the simulated provider's checkout page
//   ?view=payment-return&reference=...      where the checkout sends the guest back
//
// Query parameters rather than paths, so no hosting rewrite rules are needed and
// a provider's return URL (which appends ?reference=...) keeps working.

export type PrototypeView =
  | { page: 'site' }
  | { page: 'booking-prototype' }
  | { page: 'demo-checkout'; reference: string }
  | { page: 'payment-return'; reference: string };

const REFERENCE = /^[A-Za-z0-9.=-]{8,100}$/;

export function resolvePrototypeView(search: string, prototypeEnabled: boolean): PrototypeView {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  const reference = params.get('reference') ?? params.get('trxref') ?? '';

  if (view === 'booking-prototype' && prototypeEnabled) return { page: 'booking-prototype' };
  if ((view === 'demo-checkout' || view === 'payment-return') && REFERENCE.test(reference)) return { page: view, reference };
  return { page: 'site' };
}
