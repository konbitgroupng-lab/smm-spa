import { useEffect, useState } from 'react';
import { Calendar, X } from 'lucide-react';
import { BOOKING_SECTION_ID, goToBooking } from '../booking/navigation';

// Floating "Spa Appointments" shortcut: takes the guest to the online booking
// section on this page. It hides while that section is on screen (where it
// would only cover the booking steps), and can be dismissed for the visit.
const DISMISS_KEY = 'smm_booking_widget_dismissed';

function wasDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function SpaBookingWidget() {
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [bookingInView, setBookingInView] = useState(false);

  useEffect(() => {
    const section = document.getElementById(BOOKING_SECTION_ID);
    if (!section || typeof IntersectionObserver === 'undefined') return;
    // Several changes can arrive together (fast scrolling): the last one is current.
    const observer = new IntersectionObserver((entries) => setBookingInView(entries[entries.length - 1].isIntersecting));
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // Storage unavailable: the widget simply returns on the next visit.
    }
  };

  // Phones: wait until the guest scrolls past the top banner. There it would only
  // cover the slide dots, and the banner already offers Reserve Slot / Schedule Massage.
  const [nearTop, setNearTop] = useState(true);
  useEffect(() => {
    const update = () => setNearTop(window.scrollY < window.innerHeight * 0.6);
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  if (dismissed || bookingInView) return null;

  return (
    <div className={`fixed bottom-5 left-5 z-50 sm:bottom-6 sm:left-6 ${nearTop ? 'max-sm:hidden' : ''}`}>
      <div className="relative">
        <button
          onClick={handleDismiss}
          aria-label="Dismiss booking shortcut"
          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-spa-charcoal text-white flex items-center justify-center shadow-md hover:bg-spa-gold hover:text-spa-charcoal transition-colors z-10"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={goToBooking}
          className="flex items-center gap-2 bg-spa-gold hover:bg-spa-gold-dark text-spa-charcoal hover:text-white pl-4 pr-5 py-3.5 rounded-full shadow-xl transition-all hover:scale-105 active:scale-95"
        >
          <Calendar className="w-5 h-5" />
          <span className="text-xs font-bold uppercase tracking-widest whitespace-nowrap">Spa Appointments</span>
        </button>
      </div>
    </div>
  );
}
