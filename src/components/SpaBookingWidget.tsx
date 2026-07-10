import { useEffect, useState } from 'react';
import { Calendar, X } from 'lucide-react';
import { CALENDLY_OPENING_EVENT } from './widgetEvents';

// TODO: replace with your real Calendly event URL, e.g. https://calendly.com/your-username/spa-appointments
const CALENDLY_URL = 'https://calendly.com/your-spa-slug/spa-appointments';
const AUTO_OPEN_DELAY = 2600;
const SESSION_KEY = 'smm_calendly_auto_shown';
const DISMISS_KEY = 'smm_calendly_dismissed';

declare global {
  interface Window {
    Calendly?: {
      initPopupWidget: (options: { url: string }) => void;
      closePopupWidget?: () => void;
    };
  }
}

function ensureCalendlyAssets(): Promise<void> {
  return new Promise((resolve) => {
    if (window.Calendly) {
      resolve();
      return;
    }
    if (!document.getElementById('calendly-widget-css')) {
      const link = document.createElement('link');
      link.id = 'calendly-widget-css';
      link.rel = 'stylesheet';
      link.href = 'https://assets.calendly.com/assets/external/widget.css';
      document.head.appendChild(link);
    }
    const existingScript = document.getElementById('calendly-widget-js') as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      if (window.Calendly) resolve();
      return;
    }
    const script = document.createElement('script');
    script.id = 'calendly-widget-js';
    script.src = 'https://assets.calendly.com/assets/external/widget.js';
    script.async = true;
    script.addEventListener('load', () => resolve(), { once: true });
    document.body.appendChild(script);
  });
}

export default function SpaBookingWidget() {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === 'true');

  // Preload Calendly assets immediately, auto-open the popup once per session
  useEffect(() => {
    ensureCalendlyAssets();

    if (dismissed || sessionStorage.getItem(SESSION_KEY)) return;

    const timer = setTimeout(() => {
      sessionStorage.setItem(SESSION_KEY, 'true');
      openPopup();
    }, AUTO_OPEN_DELAY);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPopup = async () => {
    // Calendly's popup is a full-screen modal - tell the WhatsApp widget to
    // close first so it can never be trapped underneath, unable to be dismissed.
    window.dispatchEvent(new CustomEvent(CALENDLY_OPENING_EVENT));
    await ensureCalendlyAssets();
    window.Calendly?.initPopupWidget({ url: CALENDLY_URL });
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(DISMISS_KEY, 'true');
  };

  if (dismissed) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 sm:bottom-6 sm:right-6">
      <div className="relative">
        <button
          onClick={handleDismiss}
          aria-label="Dismiss booking widget"
          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-spa-charcoal text-white flex items-center justify-center shadow-md hover:bg-spa-gold hover:text-spa-charcoal transition-colors z-10"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={openPopup}
          className="flex items-center gap-2 bg-spa-gold hover:bg-spa-gold-dark text-spa-charcoal hover:text-white pl-4 pr-5 py-3.5 rounded-full shadow-xl transition-all hover:scale-105 active:scale-95"
        >
          <Calendar className="w-5 h-5" />
          <span className="text-xs font-bold uppercase tracking-widest whitespace-nowrap">Spa Appointments</span>
        </button>
      </div>
    </div>
  );
}
