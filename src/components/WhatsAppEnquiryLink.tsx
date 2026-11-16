import { serviceEnquiryMessage, whatsappUrl } from '../config/business';
import { WhatsAppIcon } from './WhatsAppWidget';

// "Ask on WhatsApp" link for one service or package: opens WhatsApp with an
// enquiry naming it and its details (duration, price).
export default function WhatsAppEnquiryLink({ name, details = [], className = '' }: { name: string; details?: (string | undefined | null)[]; className?: string }) {
  return (
    <a
      href={whatsappUrl(serviceEnquiryMessage(name, details))}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Ask about ${name} on WhatsApp`}
      className={`mt-3 flex min-h-11 items-center justify-center gap-2 rounded text-[11px] font-semibold uppercase tracking-widest text-spa-clay-text transition-colors hover:text-[#128C7E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spa-gold-dark focus-visible:ring-offset-2 ${className}`}
    >
      <WhatsAppIcon className="h-4 w-4 text-[#25D366]" />
      Ask on WhatsApp
    </a>
  );
}
