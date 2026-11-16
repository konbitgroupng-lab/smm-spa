import { MessageCircle, Phone } from 'lucide-react';
import type { ReactNode } from 'react';
import { useBookingCatalog, type CatalogApi } from '../useBookingCatalog';
import type { FunnelApi } from '../useBookingFunnel';
import BookingFunnel from './BookingFunnel';
import { focusRing, PrimaryButton } from './ui';
import { PHONE_DISPLAY, PHONE_E164, whatsappUrl } from '../../config/business';

// The site's "Book online" section: the funnel when the backend is available,
// otherwise a way to book by WhatsApp or phone. The rest of the site renders
// either way.

// Contact details from the shared business configuration.
const WHATSAPP = whatsappUrl("Hi! I'd like to book a treatment.");
const PHONE = PHONE_E164;
const PHONE_LABEL = PHONE_DISPLAY;

function Panel({ children }: { children: ReactNode }) {
  return <div className="space-y-5 rounded border border-spa-taupe bg-white p-6 text-center shadow-2xl sm:p-10">{children}</div>;
}

export function BookingUnavailable() {
  return (
    <Panel>
      <h3 className="font-serif text-2xl text-spa-charcoal">Online booking is unavailable right now</h3>
      <p className="mx-auto max-w-md text-sm text-spa-clay-text">We would still love to see you. Message or call us and we will arrange your appointment.</p>
      <div className="flex flex-col justify-center gap-3 sm:flex-row">
        <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-11 items-center justify-center gap-2 rounded bg-spa-charcoal px-6 py-3 text-xs font-bold uppercase tracking-widest text-spa-cream hover:bg-spa-gold hover:text-spa-charcoal ${focusRing}`}>
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          Book on WhatsApp
        </a>
        <a href={`tel:${PHONE}`} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded border border-spa-taupe px-6 py-3 text-xs font-semibold uppercase tracking-widest text-spa-charcoal hover:border-spa-gold-dark ${focusRing}`}>
          <Phone className="h-4 w-4" aria-hidden="true" />
          Call {PHONE_LABEL}
        </a>
      </div>
    </Panel>
  );
}

export interface BookingSectionProps {
  preselectServiceId?: string | null;
  catalogApi?: CatalogApi;
  funnelApi?: FunnelApi;
  navigate?: (url: string) => void;
  /** Defaults to this site's payment return page. */
  callbackUrl?: string;
}

export default function BookingSection({ preselectServiceId, catalogApi, funnelApi, navigate, callbackUrl }: BookingSectionProps) {
  const catalog = useBookingCatalog(catalogApi);

  if (catalog.status === 'loading') {
    return (
      <Panel>
        <p role="status" className="text-sm text-spa-clay-text">
          Loading treatments and availability…
        </p>
      </Panel>
    );
  }
  if (catalog.status === 'unavailable') return <BookingUnavailable />;
  if (catalog.status === 'error') {
    return (
      <Panel>
        <p role="alert" className="text-sm text-spa-charcoal">
          We could not load online booking. Please check your connection and try again.
        </p>
        <PrimaryButton onClick={catalog.retry}>Try again</PrimaryButton>
      </Panel>
    );
  }

  return (
    <BookingFunnel
      catalog={catalog.catalog}
      preselectServiceId={preselectServiceId}
      api={funnelApi}
      navigate={navigate}
      callbackUrl={callbackUrl ?? `${window.location.origin}/?view=payment-return`}
    />
  );
}
