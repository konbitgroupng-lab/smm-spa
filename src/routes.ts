// Chooses which page to render from the query string.
//
//   (anything else)                          the website
//   ?view=payment-return&reference=...       booking confirmation (where the checkout returns)
//   ?view=demo-checkout&reference=...        the demo payment provider's checkout (development)
//   ?view=videos[&v=<clip id>]                the Video Gallery page
//   ?view=transfer&token=<uuid>              a booking paid by bank transfer (the guest's own page)
//
// Query parameters rather than paths, so no hosting rewrite rules are needed and
// a provider's return address (which appends ?reference=...) keeps working.

export type View =
  | { page: 'site' }
  | { page: 'demo-checkout'; reference: string }
  | { page: 'payment-return'; reference: string }
  | { page: 'videos'; videoId: string | null }
  | { page: 'transfer'; token: string };

const REFERENCE = /^[A-Za-z0-9.=-]{8,100}$/;
const VIDEO_ID = /^[a-z0-9-]{1,60}$/;
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The guest's own page for a booking paid by bank transfer. */
export const transferPageUrl = (token: string) => `/?view=transfer&token=${encodeURIComponent(token)}`;

export function resolveView(search: string): View {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  const reference = params.get('reference') ?? params.get('trxref') ?? '';
  if ((view === 'demo-checkout' || view === 'payment-return') && REFERENCE.test(reference)) return { page: view, reference };
  if (view === 'transfer') {
    const token = params.get('token') ?? '';
    if (TOKEN.test(token)) return { page: 'transfer', token };
  }
  if (view === 'videos') {
    const v = params.get('v') ?? '';
    return { page: 'videos', videoId: VIDEO_ID.test(v) ? v : null };
  }
  return { page: 'site' };
}
