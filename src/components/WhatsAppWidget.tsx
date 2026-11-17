import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { X, Send } from 'lucide-react';
import { BUSINESS_NAME, openWhatsApp, WHATSAPP_WELCOME } from '../config/business';
import { BOOKING_ENGAGED_EVENT } from './widgetEvents';

// Floating WhatsApp chat concierge (bottom-right on every public page). The
// visitor writes a message here; Send opens WhatsApp (app on phones, WhatsApp
// Web/Desktop on computers) with it pre-filled to the business number. Nothing
// is stored or sent anywhere else.

export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 448 512" className={className} fill="currentColor" aria-hidden="true">
      <path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z" />
    </svg>
  );
}

const MAX_LENGTH = 1000;

export default function WhatsAppWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const reduceMotion = useReducedMotion();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();
  const titleId = useId();

  const close = (returnFocus = true) => {
    setIsOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  };

  // Step aside when the visitor starts booking, so the panel never covers the steps.
  useEffect(() => {
    const onBooking = () => setIsOpen(false);
    window.addEventListener(BOOKING_ENGAGED_EVENT, onBooking);
    return () => window.removeEventListener(BOOKING_ENGAGED_EVENT, onBooking);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const send = () => {
    openWhatsApp(message);
    setMessage('');
    close(false);
  };

  // Enter sends; Shift+Enter starts a new line.
  const onInputKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const motionProps = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, y: 16, scale: 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 12, scale: 0.97 } };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            {...motionProps}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            id={panelId}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            className="w-[calc(100vw-2.5rem)] max-w-[22rem] origin-bottom-right overflow-hidden rounded-2xl border border-black/5 bg-white shadow-2xl"
          >
            <div className="flex items-center gap-3 bg-spa-charcoal px-4 py-3.5">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-black ring-1 ring-spa-gold/40">
                <img src="/assets/images/smm_logo_cropped.png" alt="" className="h-8 w-auto" />
              </div>
              <div className="min-w-0 flex-1">
                <p id={titleId} className="font-serif text-[15px] leading-snug text-white">{BUSINESS_NAME}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-tight text-spa-linen/80">
                  <WhatsAppIcon className="h-3 w-3 text-[#25D366]" />
                  Chat with us on WhatsApp
                </p>
              </div>
              <button
                type="button"
                onClick={() => close()}
                aria-label="Close chat"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spa-gold"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="bg-spa-linen px-4 py-5">
              <div className="max-w-[90%] whitespace-pre-line rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm leading-relaxed text-spa-charcoal shadow-sm">
                {WHATSAPP_WELCOME}
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="flex items-end gap-2 border-t border-spa-taupe bg-white p-3"
            >
              <label htmlFor={`${panelId}-message`} className="sr-only">Your message</label>
              <textarea
                ref={inputRef}
                id={`${panelId}-message`}
                rows={1}
                maxLength={MAX_LENGTH}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Type your message…"
                className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-spa-taupe bg-spa-cream px-4 py-2.5 text-sm text-spa-charcoal placeholder:text-spa-clay-text focus:border-[#25D366] focus:outline-none focus:ring-1 focus:ring-[#25D366]"
              />
              <button
                type="submit"
                aria-label="Send on WhatsApp"
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white shadow-md transition-colors hover:bg-[#1ebe57] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
            <p className="bg-white px-4 pb-3 text-center text-[10px] text-spa-clay-text">Opens WhatsApp with your message ready to send.</p>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        ref={toggleRef}
        type="button"
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        aria-label={isOpen ? 'Close WhatsApp chat' : 'Chat with us on WhatsApp'}
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut', delay: reduceMotion ? 0 : 0.4 }}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-xl transition-[transform,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[#1ebe57] hover:shadow-2xl active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2"
      >
        {isOpen ? <X className="h-6 w-6" /> : <WhatsAppIcon className="h-7 w-7" />}
      </motion.button>
    </div>
  );
}
