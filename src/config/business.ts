// Business contact details and WhatsApp messages, in one place. Every WhatsApp
// link on the website is built from here.
//
// WHATSAPP_NUMBER: international format, digits only (country code first, no
// "+", spaces or leading 0) - the format WhatsApp's click-to-chat links need.
// Confirmed as the business WhatsApp number on 2026-11-17.

export const BUSINESS_NAME = 'SMM (Sweet Mobile Massage and Spa)';
export const WHATSAPP_NUMBER = '2348118599365';
export const PHONE_E164 = `+${WHATSAPP_NUMBER}`;
export const PHONE_DISPLAY = '+234 811 859 9365';

export const WHATSAPP_WELCOME = `Hello! 👋 Welcome to ${BUSINESS_NAME}.\n\nHow can we assist you today? Send us a message and our team will be happy to help.`;

/** Sent when the visitor presses Send with an empty message. */
export const WHATSAPP_DEFAULT_ENQUIRY = 'Hello! 👋 I would like to make an enquiry. Please assist me.';

/** WhatsApp click-to-chat link with the message pre-filled (wa.me opens the app on phones, WhatsApp Web or Desktop on computers). */
export function whatsappUrl(message: string = WHATSAPP_DEFAULT_ENQUIRY): string {
  const text = message.trim() || WHATSAPP_DEFAULT_ENQUIRY;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

/** Enquiry about one service or package, with its details. */
export function serviceEnquiryMessage(name: string, details: (string | undefined | null)[] = []): string {
  const extra = details.filter(Boolean).join(' · ');
  return `Hello, I am interested in ${name}${extra ? ` (${extra})` : ''}. Kindly provide me with more information.`;
}

/** Opens WhatsApp in a new tab; falls back to this tab if a pop-up blocker refuses. */
export function openWhatsApp(message?: string): void {
  const url = whatsappUrl(message);
  // Not "noopener" in the features: browsers then always return null, and a
  // blocked pop-up could not be told apart from an opened one.
  const opened = window.open(url, '_blank');
  if (opened) opened.opener = null;
  else window.location.assign(url);
}
