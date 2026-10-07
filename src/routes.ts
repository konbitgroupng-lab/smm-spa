// Chooses which page to render from the query string.
//
//   (anything else)                          the website
//   ?view=payment-return&reference=...       booking confirmation (where the checkout returns)
//   ?view=demo-checkout&reference=...        the demo payment provider's checkout (development)
//
// Query parameters rather than paths, so no hosting rewrite rules are needed and
// a provider's return address (which appends ?reference=...) keeps working.

export type View =
  | { page: 'site' }
  | { page: 'demo-checkout'; reference: string }
  | { page: 'payment-return'; reference: string };

const REFERENCE = /^[A-Za-z0-9.=-]{8,100}$/;

export function resolveView(search: string): View {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  const reference = params.get('reference') ?? params.get('trxref') ?? '';
  if ((view === 'demo-checkout' || view === 'payment-return') && REFERENCE.test(reference)) return { page: view, reference };
  return { page: 'site' };
}
