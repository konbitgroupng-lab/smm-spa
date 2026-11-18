// The spa's full menu and prices, as given on the client's price list
// ("SMM / BMM SPA", November 2026). The website's Full Price List page and
// the downloadable PDF are both made from this file.
//
// Prices are in naira. Where the spa charges differently for an in-home
// visit, `home` is that price.

export interface PriceItem {
  name: string;
  /** Price at the spa, in naira. */
  price: number;
  /** Price for an in-home visit, when it differs. */
  home?: number;
  note?: string;
}

export interface PriceSection {
  id: string;
  title: string;
  /** A line under the heading, e.g. session lengths. */
  intro?: string;
  items: PriceItem[];
}

export interface PriceGroup {
  title: string;
  sections: PriceSection[];
}

export const PRICE_LIST_UPDATED = 'November 2026';

export const PRICE_LIST: PriceGroup[] = [
  {
    title: 'Massage & Wellness',
    sections: [
      {
        id: 'massage',
        title: 'Massage & Wellness',
        intro: 'Standard massage sessions: 50 minutes to 1 hour · 2-in-1 sessions: 65 minutes · VIP sessions: 70 minutes',
        items: [
          { name: 'Swedish Massage', price: 33_000 },
          { name: 'Deep Tissue Massage', price: 35_000 },
          { name: 'Foot Massage', price: 20_000 },
          { name: 'Chair Massage', price: 30_000 },
          { name: 'Hot Stone Therapy', price: 40_000 },
          { name: 'Aromatherapy Massage', price: 40_000 },
          { name: 'Back Massage', price: 25_000 },
          { name: 'Couples Swedish Massage', price: 65_000 },
          { name: 'Couples Deep Tissue Massage', price: 70_000 },
          { name: 'Pregnancy Massage', price: 40_000 },
          { name: 'Four Hands Swedish Massage', price: 66_000 },
          { name: 'Four Hands Deep Tissue Massage', price: 70_000 },
          { name: 'Reflexology', price: 30_000 },
        ],
      },
      {
        id: 'facials',
        title: 'Facials & Sauna',
        items: [
          { name: 'High Frequency Facial', price: 30_000 },
          { name: 'Jelly Mask Facial', price: 25_000 },
          { name: 'LED Light Facial', price: 25_000 },
          { name: 'Dermaplaning Facial', price: 25_000 },
          { name: 'Vacuum Suctioning Facial', price: 25_000 },
          { name: 'Face Scrubber', price: 15_000 },
          { name: 'Anti-Aging / Anti-Wrinkle Facial', price: 25_000 },
          { name: 'Regular Facial', price: 18_000 },
          { name: 'Sauna Steam Bath – 30 minutes', price: 40_000 },
          { name: 'Sauna Steam Bath – 60 minutes', price: 65_000 },
        ],
      },
    ],
  },
  {
    title: 'Beauty & Body Treatments',
    sections: [
      {
        id: 'pedicure',
        title: 'Pedicure',
        items: [
          { name: 'Regular Pedicure', price: 18_000 },
          { name: 'Jelly Pedicure', price: 20_000 },
          { name: 'Lemon Pedicure', price: 20_000 },
        ],
      },
      {
        id: 'scrub',
        title: 'Body Polishing / Exfoliation / Scrub',
        intro: 'Two prices: at the spa / at your home.',
        items: [
          { name: 'Regular Body Scrub with Sauna', price: 40_000, home: 50_000, note: '2 sessions' },
          { name: 'Hammam Moroccan Body Scrub', price: 60_000, home: 70_000, note: 'With sauna before and after the treatment (2 sessions)' },
        ],
      },
      {
        id: 'waxing',
        title: 'Waxing / Hair Removal',
        items: [
          { name: 'Soft Wax', price: 20_000, note: 'For fine or soft hair' },
          { name: 'Hard Wax', price: 25_000, note: 'For stubborn or thick hair' },
          { name: 'Honey / Sugar Wax', price: 30_000 },
          { name: 'Brazilian Wax Removal / Bikini Hairline', price: 50_000, note: 'Full coverage removal' },
          { name: 'Wax Powder', price: 25_000 },
        ],
      },
    ],
  },
];

/** Every service on the list, in order. */
export const allPriceItems = (): PriceItem[] => PRICE_LIST.flatMap((g) => g.sections.flatMap((s) => s.items));

/** "₦33,000". */
export const naira = (amount: number) => `₦${amount.toLocaleString('en-NG')}`;

/** The price as shown on the list: "₦60,000" or "₦60,000 at the spa / ₦70,000 at home". */
export function priceText(item: PriceItem): string {
  return item.home ? `${naira(item.price)} at the spa / ${naira(item.home)} at home` : naira(item.price);
}

/** The couples and four-hands experiences shown on the homepage; booked on WhatsApp (two therapists). */
export const COUPLES_EXPERIENCES = [
  {
    id: 'couples-swedish',
    name: 'Couples Swedish Massage',
    price: 65_000,
    duration: 65,
    description: 'Side-by-side Swedish massage for two, with two therapists working at the same time. Long, flowing strokes to ease tension and help you both unwind.',
    imageUrl: '/assets/images/spa_wellness_corner_1783345984514.jpg',
  },
  {
    id: 'four-hands-swedish',
    name: 'Four Hands Swedish Massage',
    price: 66_000,
    duration: 65,
    description: 'Two therapists work in harmony on one guest: a deeply immersive Swedish massage with twice the hands and perfectly mirrored strokes.',
    imageUrl: '/assets/images/spa_aromatherapy_1783346057871.jpg',
    popular: false,
  },
  {
    id: 'couples-deep-tissue',
    name: 'Couples Deep Tissue Massage',
    price: 70_000,
    duration: 65,
    description: 'Firm, targeted deep tissue work for two guests side by side, for chronic tightness, knots and post-workout soreness.',
    imageUrl: '/assets/images/spa_hero_banner_1783345955168.jpg',
  },
];
