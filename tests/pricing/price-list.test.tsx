// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setContactDetails } from '../../src/config/business';
import { allPriceItems, PRICE_LIST, priceText } from '../../src/content/priceList';
import { servicesData } from '../../src/data';
import PriceListPage from '../../src/pricing/PriceListPage';
import { PRICE_LIST_PDF, PRICE_LIST_URL, resolveView } from '../../src/routes';
import { installBrowserStubs } from '../site/browser-stubs';

// The Full Price List page (?view=prices), made from the client's price list.

const root = path.resolve(__dirname, '../..');
beforeAll(installBrowserStubs);
afterEach(() => {
  cleanup();
  setContactDetails(null);
});

describe('the price list', () => {
  it('has every service from the client\'s list: 33, in five sections', () => {
    const sections = PRICE_LIST.flatMap((g) => g.sections);
    expect(sections.map((s) => s.title)).toEqual([
      'Massage & Wellness', 'Facials & Sauna', 'Pedicure', 'Body Polishing / Exfoliation / Scrub', 'Waxing / Hair Removal',
    ]);
    expect(allPriceItems()).toHaveLength(33);
    expect(priceText(allPriceItems().find((i) => i.name === 'Hammam Moroccan Body Scrub')!)).toBe('₦60,000 at the spa / ₦70,000 at home');
  });

  it('the six homepage treatments cost what the price list says', () => {
    const listed = new Map(allPriceItems().map((i) => [i.name, i.price]));
    for (const s of servicesData) expect(listed.get(s.name), s.name).toBe(s.price);
  });

  it('is its own page, reached from the homepage and the menu', () => {
    expect(resolveView(PRICE_LIST_URL.slice(1))).toEqual({ page: 'prices' });
    expect(PRICE_LIST_URL).toBe('/?view=prices');
  });

  it('shows each service with its price in naira, a WhatsApp enquiry for it, and the three phone numbers', () => {
    render(<PriceListPage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Full Price List');
    const massage = screen.getByRole('region', { name: 'Massage & Wellness' });
    const swedish = within(massage).getByText('Swedish Massage').closest('li')!;
    expect(swedish.textContent).toContain('₦33,000');
    const ask = within(swedish).getByRole('link', { name: 'Ask about Swedish Massage on WhatsApp' });
    expect(new URL(ask.getAttribute('href')!).searchParams.get('text')).toContain('Swedish Massage (₦33,000)');
    expect(document.body.textContent).not.toContain('■'); // the original PDF's broken naira sign
    expect(screen.getAllByRole('link', { name: /on whatsapp$/i }).length).toBeGreaterThanOrEqual(33);

    const call = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('tel:')).map((a) => a.getAttribute('href'));
    expect(call).toEqual(['tel:+2348118599365', 'tel:+2349135330351', 'tel:+2347010900261']);
    expect(screen.getByRole('link', { name: /download pdf/i }).getAttribute('href')).toBe(PRICE_LIST_PDF);
  });

  it('the downloadable PDF is in the website', () => {
    const file = path.join(root, 'public', PRICE_LIST_PDF);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
