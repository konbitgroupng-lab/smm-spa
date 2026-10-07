// WhatsAppWidget (left unchanged) still closes a Calendly popup if one is open.
// Calendly is no longer loaded by the site, so at run time this is always
// undefined; the declaration only keeps that existing check type-safe.
interface Window {
  Calendly?: {
    closePopupWidget?: () => void;
  };
}
