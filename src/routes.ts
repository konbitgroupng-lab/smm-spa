// Chooses which page to render from the query string.
//
//   (anything else)                          the website
//   ?view=payment-return&reference=...       booking confirmation (where the checkout returns)
//   ?view=demo-checkout&reference=...        the demo payment provider's checkout (development)
//   ?view=videos[&v=<clip id>]                the Video Gallery page
//
// Query parameters rather than paths, so no hosting rewrite rules are needed and
// a provider's return address (which appends ?reference=...) keeps working.

export type View =
  | { page: 'site' }
  | { page: 'demo-checkout'; reference: string }
  | { page: 'payment-return'; reference: string }
  | { page: 'videos'; videoId: string | null };

const REFERENCE = /^[A-Za-z0-9.=-]{8,100}$/;
const VIDEO_ID = /^[a-z0-9-]{1,60}$/;

export function resolveView(search: string): View {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  const reference = params.get('reference') ?? params.get('trxref') ?? '';
  if ((view === 'demo-checkout' || view === 'payment-return') && REFERENCE.test(reference)) return { page: view, reference };
  if (view === 'videos') {
    const v = params.get('v') ?? '';
    return { page: 'videos', videoId: VIDEO_ID.test(v) ? v : null };
  }
  return { page: 'site' };
}
