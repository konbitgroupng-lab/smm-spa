// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import App from '../../src/App';
import Eyebrow, { EYEBROW_TEXT } from '../../src/components/Eyebrow';
import {
  contactDetails, DEFAULT_CONTACT, GOOGLE_REVIEWS, setContactDetails, toPhoneNumber, toWhatsAppNumber, whatsappUrl,
} from '../../src/config/business';
import { BUILT_IN_CONTENT, mergeContent, type SiteContent } from '../../src/content/useSiteContent';
import { faqsData, galleryData } from '../../src/data';
import { installBrowserStubs } from '../site/browser-stubs';

// Phase 6c: the public site shows the owner's content (staff app > Website),
// falls back to its built-in content, and never shows invented reviews.

beforeAll(installBrowserStubs);
afterEach(() => {
  cleanup();
  setContactDetails(null);
});

const NONE = { faqs: null, gallery: null, testimonials: null, announcements: null, hero: null, contact: null };

describe('contact details', () => {
  it('phone numbers: international, Nigerian local, or refused', () => {
    expect(toPhoneNumber('+234 811 859 9365')).toEqual({ display: '+234 811 859 9365', tel: '+2348118599365' });
    expect(toPhoneNumber('0811 859 9365')).toEqual({ display: '0811 859 9365', tel: '+2348118599365' });
    expect(toPhoneNumber('call us')).toBeNull();
    expect(toPhoneNumber('')).toBeNull();
    expect(toWhatsAppNumber('+234 811 859 9365')).toBe('2348118599365');
    expect(toWhatsAppNumber('08118599365')).toBe('2348118599365');
    expect(toWhatsAppNumber('12')).toBeNull();
  });

  it('the saved details replace the built-in ones; blank optional ones are hidden, blank numbers keep the built-in', () => {
    setContactDetails({ address: '  ', phone: '', phone_secondary: null, email: 'hello@smm.example', whatsapp: '+234 700 000 0001' });
    expect(contactDetails()).toEqual({
      phone: DEFAULT_CONTACT.phone, phoneSecondary: null, phoneThird: null, email: 'hello@smm.example', address: null, whatsapp: '2347000000001',
    });
    expect(whatsappUrl('Hi')).toBe('https://wa.me/2347000000001?text=Hi');
    setContactDetails(null);
    expect(whatsappUrl('Hi')).toBe('https://wa.me/2348118599365?text=Hi');
  });

  it('the footer shows the saved details', () => {
    setContactDetails({ address: 'Lekki Phase 1, Lagos', phone: '+234 811 859 9365', phone_secondary: null, email: null, whatsapp: null });
    render(<App />);
    const footer = document.querySelector('footer')!;
    expect(within(footer).getByText('Lekki Phase 1, Lagos')).toBeTruthy();
    expect(within(footer).queryByText(/@/)).toBeNull();
    expect(within(footer).getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('tel:')).map((a) => a.getAttribute('href'))).toEqual(['tel:+2348118599365']);
  });
});

describe('content', () => {
  it('nothing loaded: the built-in FAQs and gallery, no reviews, the built-in heading', () => {
    expect(mergeContent(NONE)).toEqual(BUILT_IN_CONTENT);
    expect(BUILT_IN_CONTENT.testimonials).toEqual([]);
    expect(mergeContent({ ...NONE, faqs: [], gallery: [] })).toMatchObject({ faqs: faqsData, gallery: galleryData });
    expect(mergeContent({ ...NONE, hero: { heading: '  ', subheading: 'x' } }).hero).toBeNull();
  });

  it('without published reviews there is no reviews section; with one it shows, with its stars as text', () => {
    render(<App content={BUILT_IN_CONTENT} />);
    expect(screen.queryByRole('heading', { name: /feedback/i })).toBeNull();
    cleanup();

    const content: SiteContent = {
      ...BUILT_IN_CONTENT,
      testimonials: [{ id: 't', name: 'Adaeze O.', location: 'Lekki', text: 'Calm and professional.', rating: 4, serviceName: '' }],
    };
    render(<App content={content} />);
    expect(screen.getByRole('heading', { name: /tranquil feedback/i })).toBeTruthy();
    expect(screen.getByText('Adaeze O.')).toBeTruthy();
    expect(screen.getByRole('img', { name: '4 out of 5 stars' })).toBeTruthy();
    // The spa's Google rating, and a link to every review on Google (new tab).
    expect(screen.getByText(`from ${GOOGLE_REVIEWS.count} Google reviews`)).toBeTruthy();
    const google = screen.getByRole('link', { name: `Read all ${GOOGLE_REVIEWS.count} reviews on Google (opens in a new tab)` });
    expect(google.getAttribute('href')).toBe(GOOGLE_REVIEWS.url);
    expect(google.getAttribute('target')).toBe('_blank');
    expect(google.getAttribute('rel')).toContain('noopener');
    // The numbers bar quotes the same rating.
    expect(screen.getByText(`From ${GOOGLE_REVIEWS.count} Google reviews`)).toBeTruthy();
  });

  it("the owner's FAQs, heading and announcements are shown as plain text", () => {
    const content: SiteContent = {
      ...BUILT_IN_CONTENT,
      faqs: [{ id: 'f', question: 'Is there parking? <b>bold</b>', answer: 'Yes, two spaces.' }],
      hero: { heading: 'Calm, on your terms', subheading: 'Lagos mobile spa.' },
      announcements: [{ id: 'a', kind: 'promotion', title: 'December offer', body: '15% off packages' }],
    };
    render(<App content={content} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Calm, on your terms');
    expect(screen.getByText('Lagos mobile spa.')).toBeTruthy();
    const faqs = document.getElementById('faqs')!;
    expect(within(faqs).getByText('Is there parking? <b>bold</b>')).toBeTruthy();
    expect(faqs.querySelector('b')).toBeNull();
    const strip = screen.getByRole('region', { name: 'Announcements' });
    expect(strip.textContent).toContain('Promotion: December offer — 15% off packages');
  });
});

// ---------------------------------------------------------------------------
// Gold text contrast (WCAG 2.1 AA: 4.5:1 for text)

const css = readFileSync(path.resolve(__dirname, '../../src/index.css'), 'utf8');
const token = (name: string) => css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))![1];
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('gold text', () => {
  it('section labels on light backgrounds use the dark bronze, which reads at 4.5:1 or more on every light panel', () => {
    expect(EYEBROW_TEXT.light).toBe('text-spa-gold-dark');
    for (const bg of ['#ffffff', token('spa-cream'), token('spa-linen'), token('spa-taupe')]) {
      expect(contrast(token('spa-gold-dark'), bg), bg).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token('spa-clay-text'), bg), bg).toBeGreaterThanOrEqual(4.5);
    }
    // Why: the bright brand gold is far too faint on light backgrounds; it is kept for dark ones.
    expect(contrast(token('spa-gold'), token('spa-cream'))).toBeLessThan(2);
    expect(contrast(token('spa-gold'), token('spa-charcoal'))).toBeGreaterThanOrEqual(4.5);
  });

  it('the label keeps a decorative gold rule, hidden from screen readers', () => {
    render(<Eyebrow>Curated Therapy</Eyebrow>);
    const label = screen.getByText('Curated Therapy').parentElement!;
    expect(label.className).toContain('text-spa-gold-dark');
    const rules = label.querySelectorAll('[aria-hidden="true"]');
    expect(rules.length).toBe(2);
    rules.forEach((r) => expect(r.className).toContain('bg-spa-gold'));
  });

  it('no light-background section label on the homepage still uses the bright gold for its words', () => {
    render(<App />);
    const labels = ['The SMM Vibe', 'Curated Therapy', 'Share the Calm', 'Seamless Reservation', 'Tranquility Captured', 'See It In Motion', 'The Hands Behind The Ritual', 'Clear Guidance'];
    for (const text of labels) {
      const el = screen.getByText(text).parentElement!;
      expect(el.className, text).toContain('text-spa-gold-dark');
    }
  });
});
