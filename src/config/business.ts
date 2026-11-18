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

// ---------------------------------------------------------------------------
// Contact details. The values above are the built-in ones; the owner can
// change them in the staff app (Website > Contact details), and the site
// applies them with setContactDetails() once they have loaded.

export interface PhoneNumber {
  display: string;
  /** For tel: links: + and digits. */
  tel: string;
}

export interface ContactInfo {
  phone: PhoneNumber;
  phoneSecondary: PhoneNumber | null;
  phoneThird: PhoneNumber | null;
  email: string | null;
  address: string | null;
  /** WhatsApp number, digits only, country code first. */
  whatsapp: string;
}

export const DEFAULT_CONTACT: ContactInfo = {
  phone: { display: PHONE_DISPLAY, tel: PHONE_E164 },
  // The spa's other two lines, from its price list (November 2026).
  phoneSecondary: { display: '+234 913 533 0351', tel: '+2349135330351' },
  phoneThird: { display: '+234 701 090 0261', tel: '+2347010900261' },
  email: 'ogebestie7@gmail.com',
  address: '9B Oki Lane, Mende, Maryland, Lagos.',
  whatsapp: WHATSAPP_NUMBER,
};

let contact: ContactInfo = DEFAULT_CONTACT;

/** The contact details the site shows now. */
export function contactDetails(): ContactInfo {
  return contact;
}

const digitsOf = (text: string) => text.replace(/\D/g, '');

/** "+234 811 859 9365" or "0811 859 9365" (Nigeria) to a dialable number; null if it is not one. */
export function toPhoneNumber(text: string | null | undefined): PhoneNumber | null {
  const display = (text ?? '').trim();
  const digits = digitsOf(display);
  if (digits.length < 7 || digits.length > 15) return null;
  if (display.startsWith('+')) return { display, tel: `+${digits}` };
  if (digits.startsWith('0') && digits.length === 11) return { display, tel: `+234${digits.slice(1)}` };
  return { display, tel: `+${digits}` };
}

/** A WhatsApp number in the digits-only international form wa.me needs; null if it is not one. */
export function toWhatsAppNumber(text: string | null | undefined): string | null {
  let digits = digitsOf(text ?? '');
  if (digits.startsWith('0') && digits.length === 11) digits = `234${digits.slice(1)}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export interface SavedContact {
  address?: string | null;
  phone?: string | null;
  phone_secondary?: string | null;
  phone_third?: string | null;
  email?: string | null;
  whatsapp?: string | null;
}

/**
 * Applies the contact details saved in the staff app. A blank address,
 * second phone or email is hidden; a blank or invalid main phone or WhatsApp
 * number keeps the built-in one, so guests can always reach the spa.
 */
export function setContactDetails(saved: SavedContact | null): ContactInfo {
  if (!saved) {
    contact = DEFAULT_CONTACT;
    return contact;
  }
  const text = (v: string | null | undefined) => (v ?? '').trim() || null;
  const email = text(saved.email);
  contact = {
    phone: toPhoneNumber(saved.phone) ?? DEFAULT_CONTACT.phone,
    phoneSecondary: toPhoneNumber(saved.phone_secondary),
    phoneThird: toPhoneNumber(saved.phone_third),
    email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
    address: text(saved.address),
    whatsapp: toWhatsAppNumber(saved.whatsapp) ?? DEFAULT_CONTACT.whatsapp,
  };
  return contact;
}

/** WhatsApp click-to-chat link with the message pre-filled (wa.me opens the app on phones, WhatsApp Web or Desktop on computers). */
export function whatsappUrl(message: string = WHATSAPP_DEFAULT_ENQUIRY): string {
  const text = message.trim() || WHATSAPP_DEFAULT_ENQUIRY;
  return `https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(text)}`;
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
