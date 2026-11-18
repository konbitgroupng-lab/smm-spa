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
    id: 'facial-treatment',
    name: 'Premium Facial Treatment',
    category: 'Skincare',
    duration: 60,
    price: 45000,
    formattedPrice: '₦45,000',
    description: 'An advanced hydrating facial using precision skin-resurfacing technology to deep-cleanse pores, boost circulation, and reveal a smoother, more radiant complexion.',
    benefits: [
      'Deep-cleanses & unclogs congested pores',
      'Boosts collagen production & skin elasticity',
      'Improves circulation for a natural, healthy glow',
      'Reduces fine lines & uneven skin texture',
      'Leaves skin visibly smoother & more hydrated'
    ],
    imageUrl: '/assets/images/facial-treatment.jpg'
  },
  {
    id: 'swedish',
    name: 'Swedish Massage',
    category: 'Relaxation',
    duration: 60,
    price: 40000,
    formattedPrice: '₦40,000',
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
    price: 40000,
    formattedPrice: '₦40,000',
    description: 'Designed to target deep layers of muscle and connective tissue. Highly beneficial for chronic muscle tightness, soreness, and physical fatigue.',
    benefits: [
      'Alleviates chronic muscle pain & heavy tension',
      'Improves posture, mobility, & overall range of motion',
      'Breaks down painful scar tissue & knots',
      'Accelerates muscle recovery & athletic repair',
      'Provides profound somatic stress relief'
    ],
    imageUrl: '/assets/images/deep-tissue-massage.jpg'
  },
  {
    id: 'hot-stone',
    name: 'Hot Stone Therapy',
    category: 'Sensory',
    duration: 60,
    price: 50000,
    formattedPrice: '₦50,000',
    description: 'Combining smooth, heated basalt volcanic stones with traditional massage strokes to penetrate deep warmth into your muscles, encouraging deep sensory harmony.',
    benefits: [
      'Relieves intense muscle tension & somatic discomfort',
      'Soothing thermal action improves blood circulation',
      'Assists in deep lymphatic drainage',
      'Soothes symptoms of restlessness, anxiety, & mental fatigue',
      'Unlocks energy flow and emotional peace'
    ],
    imageUrl: '/assets/images/hot_stone_massage_1783345970205.jpg'
  },
  {
    id: 'nuru',
    name: 'Nuru Massage',
    category: 'Sensory & Ultimate Wellness',
    duration: 60,
    price: 80000,
    formattedPrice: '₦80,000',
    description: 'A deeply sensual and nourishing therapy that utilizes seaweed-based lubricants for a uniquely fluid, body-to-body touch technique that unlocks ultimate relaxation.',
    benefits: [
      'Provides an unmatched full-body sensory experience',
      'Extremely skin-hydrating seaweed formulation',
      'Deeply calming for the nervous system',
      'Dissolves absolute muscular and psychological fatigue',
      'Customized and catered with highest professional standards'
    ],
    imageUrl: '/assets/images/nuru-massage.jpg'
  },
  {
    id: 'thai-massage',
    name: 'Thai Massage',
    category: 'Therapeutic',
    duration: 60,
    price: 45000,
    formattedPrice: '₦45,000',
    description: 'A traditional therapy combining assisted stretching and rhythmic compression along the body\'s energy lines to relieve tension, stress, and stiffness.',
    benefits: [
      'Relieves tension & stress throughout the body',
      'Improves flexibility & joint range of motion',
      'Stimulates circulation & energy flow',
      'Eases stiffness in the back, hips, & shoulders',
      'Leaves the mind and body feeling restored'
    ],
    imageUrl: '/assets/images/thai-massage.jpg'
  }
];

export interface SpaPackage extends Service {
  includedServiceIds: string[];
  originalPrice: number;
  formattedOriginalPrice: string;
  popular?: boolean;
}

export const packagesData: SpaPackage[] = [
  {
    id: 'pkg-essential',
    name: 'Essential Escape',
    category: 'Package',
    duration: 120,
    price: 80000,
    formattedPrice: '₦80,000',
    originalPrice: 90000,
    formattedOriginalPrice: '₦90,000',
    includedServiceIds: ['swedish', 'hot-stone'],
    description: 'A calming two-treatment introduction pairing our signature Swedish massage with warming Hot Stone therapy.',
    benefits: [
      'Swedish Massage (60 mins)',
      'Hot Stone Therapy (60 mins)',
      'Save ₦10,000 versus booking separately'
    ],
    imageUrl: '/assets/images/spa_wellness_corner_1783345984514.jpg'
  },
  {
    id: 'pkg-signature',
    name: 'Signature Retreat',
    category: 'Package',
    duration: 180,
    price: 110000,
    formattedPrice: '₦110,000',
    originalPrice: 130000,
    formattedOriginalPrice: '₦130,000',
    popular: true,
    includedServiceIds: ['swedish', 'deep-tissue', 'hot-stone'],
    description: 'Our most-booked combination — full-body relaxation, therapeutic muscle work, and soothing warmth in one extended sanctuary visit.',
    benefits: [
      'Swedish Massage (60 mins)',
      'Deep Tissue Massage (60 mins)',
      'Hot Stone Therapy (60 mins)',
      'Save ₦20,000 versus booking separately'
    ],
    imageUrl: '/assets/images/hot_stone_massage_1783345970205.jpg'
  },
  {
    id: 'pkg-ultimate',
    name: 'Ultimate Indulgence',
    category: 'Package',
    duration: 240,
    price: 175000,
    formattedPrice: '₦175,000',
    originalPrice: 210000,
    formattedOriginalPrice: '₦210,000',
    includedServiceIds: ['swedish', 'deep-tissue', 'hot-stone', 'nuru'],
    description: 'The complete SMM ritual — every signature therapy in a single unhurried, four-hour wellness journey.',
    benefits: [
      'Swedish Massage (60 mins)',
      'Deep Tissue Massage (60 mins)',
      'Hot Stone Therapy (60 mins)',
      'Nuru Massage (60 mins)',
      'Save ₦35,000 versus booking separately'
    ],
    imageUrl: '/assets/images/spa_aromatherapy_1783346057871.jpg'
  }
];

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
