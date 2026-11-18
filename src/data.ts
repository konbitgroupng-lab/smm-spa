export interface Service {
  id: string;
  name: string;
  category: string;
  duration: number; // in minutes
  price: number; // in NGN
  formattedPrice: string;
  description: string;
  benefits: string[];
  imageUrl: string;
}

export interface Therapist {
  id: string;
  name: string;
  role: string;
  specialty: string;
  bio: string;
  rating: number;
  avatarUrl: string;
}

export interface FAQItem {
  id: string;
  question: string;
  answer: string | string[];
}

export interface GalleryItem {
  id: string;
  title: string;
  category: 'sanctuary' | 'treatments' | 'therapy';
  imageUrl: string;
  /** Description for screen readers, when the picture has one; else the title is used. */
  altText?: string;
}

export interface Testimonial {
  id: string;
  name: string;
  location: string;
  text: string;
  rating: number;
  serviceName: string;
}

export const servicesData: Service[] = [
  {
    id: 'swedish',
    name: 'Swedish Massage',
    category: 'Relaxation',
    duration: 60,
    price: 33000,
    formattedPrice: '₦33,000',
    description: 'A classic relaxation therapy utilizing long, gliding strokes and gentle kneading to melt away daily stress and tension.',
    benefits: [
      'Promotes deep body relaxation & stress relief',
      'Improves blood circulation & lymph flow',
      'Relieves light muscle tension & joint stiffness',
      'Alleviates mild headaches & migraines',
      'Boosts overall well-being & enhances deep sleep'
    ],
    imageUrl: '/assets/images/swedish_massage_1783346044608.jpg'
  },
  {
    id: 'deep-tissue',
    name: 'Deep Tissue Massage',
    category: 'Therapeutic',
    duration: 60,
    price: 35000,
    formattedPrice: '₦35,000',
    description: 'Designed to target deep layers of muscle and connective tissue. Highly beneficial for chronic muscle tightness, soreness, and physical fatigue.',
    benefits: [
      'Alleviates chronic muscle pain & heavy tension',
      'Improves posture, mobility, & overall range of motion',
      'Works out painful knots & tight spots',
      'Supports muscle recovery after exercise',
      'Provides deep, lasting stress relief'
    ],
    imageUrl: '/assets/images/deep-tissue-massage.jpg'
  },
  {
    id: 'hot-stone',
    name: 'Hot Stone Therapy',
    category: 'Sensory',
    duration: 60,
    price: 40000,
    formattedPrice: '₦40,000',
    description: 'Combining smooth, heated basalt stones with traditional massage strokes to carry deep warmth into your muscles and melt away tension.',
    benefits: [
      'Relieves intense muscle tension & discomfort',
      'Soothing warmth improves blood circulation',
      'Eases restlessness, anxiety & mental fatigue',
      'Loosens tight muscles before deeper work',
      'Leaves you calm, warm and deeply rested'
    ],
    imageUrl: '/assets/images/hot_stone_massage_1783345970205.jpg'
  },
  {
    id: 'aromatherapy',
    name: 'Aromatherapy Massage',
    category: 'Relaxation',
    duration: 60,
    price: 40000,
    formattedPrice: '₦40,000',
    description: 'A soothing full-body massage with blended essential oils, chosen to help you relax, breathe deeply and let go of the day.',
    benefits: [
      'Calming essential oils for body and mind',
      'Gentle, flowing strokes for deep relaxation',
      'Helps ease stress and improve sleep',
      'Nourishes and softens the skin',
      'Leaves a light, lasting sense of calm'
    ],
    imageUrl: '/assets/images/aromatherapy-massage.jpg'
  },
  {
    id: 'moroccan-scrub',
    name: 'Hammam Moroccan Body Scrub',
    category: 'Body Treatment',
    duration: 90,
    price: 60000,
    formattedPrice: '₦60,000',
    description: 'A deep, Hammam-style exfoliating body scrub with a sauna session before and after the treatment, for smooth, glowing skin. ₦70,000 for an in-home visit.',
    benefits: [
      'Removes dead skin for a smoother, brighter glow',
      'Sauna before and after opens and refreshes the skin',
      'Helps even out dull, uneven skin tone',
      'Leaves skin baby-soft and ready to absorb moisture',
      'A deeply cleansing, restorative ritual'
    ],
    imageUrl: '/assets/images/moroccan-body-scrub.jpg'
  },
  {
    id: 'facial-treatment',
    name: 'High Frequency Facial',
    category: 'Skincare',
    duration: 60,
    price: 30000,
    formattedPrice: '₦30,000',
    description: 'A deep-cleansing facial finished with a high-frequency wand that gently energises the skin, helps calm breakouts and leaves the complexion clear and refreshed.',
    benefits: [
      'Deep-cleanses & unclogs congested pores',
      'Helps calm breakouts and blemishes',
      'Boosts circulation for a natural, healthy glow',
      'Refines uneven skin texture',
      'Leaves skin visibly smoother & refreshed'
    ],
    imageUrl: '/assets/images/facial-treatment.jpg'
  }
];

export interface SpaPackage extends Service {
  includedServiceIds: string[];
  originalPrice: number;
  formattedOriginalPrice: string;
  popular?: boolean;
}

// Bundled packages offered for online booking. None at the moment: the couples and
// four-hands experiences need two therapists and are booked on WhatsApp
// (src/content/priceList.ts, COUPLES_EXPERIENCES).
export const packagesData: SpaPackage[] = [];

export const therapistsData: Therapist[] = [
  {
    id: 'therapist-1',
    name: 'Senior Massage Therapist',
    role: 'Swedish & Relaxation Massage',
    specialty: 'Swedish & Aromatherapy',
    bio: 'Brings a calm, intuitive touch to every session, easing tension through slow, rhythmic Swedish strokes and aromatic oils.',
    rating: 5,
    avatarUrl: '/assets/images/team/therapist-1.jpg'
  },
  {
    id: 'therapist-2',
    name: 'Lead Spa Therapist',
    role: 'Hot Stone & Aromatherapy',
    specialty: 'Hot Stone & Luxury Wellness',
    bio: 'Combines heated stones and warm aromatic oils to melt away deep-seated tension and restore a sense of balance.',
    rating: 5,
    avatarUrl: '/assets/images/team/therapist-2.jpg'
  },
  {
    id: 'therapist-3',
    name: 'Skincare & Facial Specialist',
    role: 'Facials & Skin Treatments',
    specialty: 'Facials & Waxing',
    bio: 'Delivers premium facials, waxing, and skin-glow treatments tailored to leave clients refreshed and radiant.',
    rating: 5,
    avatarUrl: '/assets/images/team/therapist-3.jpg'
  },
  {
    id: 'therapist-4',
    name: 'Wellness Therapist',
    role: 'Full Body Detox & Reflexology',
    specialty: 'Detox & Reflexology',
    bio: 'Specializes in full body detox and reflexology, helping clients release toxins and restore natural energy flow.',
    rating: 4.9,
    avatarUrl: '/assets/images/team/therapist-4.jpg'
  }
];

export const galleryData: GalleryItem[] = [
  {
    id: 'gal-1',
    title: 'Serene Sanctuary Room',
    category: 'sanctuary',
    imageUrl: '/assets/images/spa_hero_banner_1783345955168.jpg'
  },
  {
    id: 'gal-2',
    title: 'Heated Volcanic Basalt Stones',
    category: 'treatments',
    imageUrl: '/assets/images/gallery-hot-stones.jpg'
  },
  {
    id: 'gal-3',
    title: 'Aromatherapy Oils & Rituals',
    category: 'therapy',
    imageUrl: '/assets/images/spa_aromatherapy_1783346057871.jpg'
  },
  {
    id: 'gal-4',
    title: 'Relaxation Lounge',
    category: 'sanctuary',
    imageUrl: '/assets/images/spa_wellness_corner_1783345984514.jpg'
  },
  {
    id: 'gal-5',
    title: 'Professional Swedish Treatment',
    category: 'treatments',
    imageUrl: '/assets/images/swedish_massage_1783346044608.jpg'
  },
  {
    id: 'gal-6',
    title: 'Zen Botanical Corner',
    category: 'sanctuary',
    imageUrl: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&q=80&w=600&h=450'
  }
];

export const testimonialsData: Testimonial[] = [
  {
    id: 't-1',
    name: 'Chioma Nwachukwu',
    location: 'Lekki Phase 1',
    text: 'I booked the Mobile Hot Stone Massage to my apartment, and the experience was truly incredible. The therapist arrived with specialized warmers, soft music, and pristine linens. It felt like a 5-star hotel in my own living room.',
    rating: 5,
    serviceName: 'Hot Stone Therapy'
  },
  {
    id: 't-2',
    name: 'Tunde Bakare',
    location: 'Ikeja Gra',
    text: 'Best Deep Tissue massage I have had in Lagos. David really knows muscular structure. He targetted my lower back tightness perfectly. The boutique sanctuary in Mende, Maryland is incredibly quiet and peaceful.',
    rating: 5,
    serviceName: 'Deep Tissue Massage'
  },
  {
    id: 't-3',
    name: 'Sarah Adebayo',
    location: 'Victoria Island',
    text: 'SMM (Sweet Mobile Massage and Spa) is my monthly luxury treat. Their online booking is seamless, and their level of transparency about pricing is so refreshing—no hidden costs. Highly recommend Amina for Swedish bliss.',
    rating: 5,
    serviceName: 'Swedish Massage'
  }
];

export const faqsData: FAQItem[] = [
  {
    id: 'faq-1',
    question: 'How long is a typical massage session?',
    answer: 'Our standard curated massage sessions are 60 minutes of hands-on treatment. Extended sessions can be arranged upon custom request.'
  },
  {
    id: 'faq-2',
    question: 'What should I wear during a massage?',
    answer: 'Wear loose, comfortable clothing that you can easily transition out of. During the massage, you will be professionally draped with white luxury linens at all times, exposing only the specific area being treated.'
  },
  {
    id: 'faq-3',
    question: 'Do I need a prior appointment?',
    answer: 'Yes, we operate strictly by appointment to guarantee a serene, uncrowded space for every guest. Please note that booking payment validation secures your time slot.'
  },
  {
    id: 'faq-4',
    question: 'What is your cancellation or rescheduling policy?',
    answer: 'We request a minimum of 24 hours notice for any appointment cancellations or rescheduling. Cancellations made within 24 hours of your slot are subject to a standard 35% cancellation fee to compensate our therapists.'
  },
  {
    id: 'faq-5',
    question: 'Where is your serene sanctuary located?',
    answer: 'Our boutique physical sanctuary is located at: 9B Oki Lane, Mende, Maryland, Lagos, Nigeria. It is a secure, peaceful spot on the Mainland, easily reached from Ikeja, Yaba, and Gbagada.'
  },
  {
    id: 'faq-6',
    question: 'What forms of payment do you accept?',
    answer: 'We accept instant bank transfers and secure online credit/debit card payments. For mobile in-home services, prepayments are required to validate the booking and dispatch therapists.'
  },
  {
    id: 'faq-7',
    question: 'Are the in-home mobile services the same price?',
    answer: [
      'Yes, the base service prices are identical!',
      'We charge a nominal transport dispatch fee depending on your exact Lagos location (Lekki, VI, Ikeja, etc.) which is displayed transparently when finalizing your mobile booking.'
    ]
  }
];
