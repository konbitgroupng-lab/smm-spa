import React, { useState, useEffect } from 'react';
import { 
  motion, 
  AnimatePresence,
  useReducedMotion
} from 'motion/react';
import { 
  Calendar, 
  Clock, 
  MapPin, 
  User, 
  Mail, 
  Phone, 
  ChevronDown, 
  ChevronUp,
  Check, 
  ArrowRight, 
  Home, 
  Award, 
  ShieldCheck, 
  HelpCircle, 
  X, 
  Printer, 
  Trash2, 
  Heart, 
  Info, 
  Instagram, 
  ArrowLeft,
  CalendarCheck,
  Map,
  FileText,
  CreditCard,
  CheckCircle2,
  Sparkles,
  Star,
  Users,
  Gift,
  Crown,
  BadgePercent,
  Send,
  Play,
  Pause,
  ExternalLink
} from 'lucide-react';
import {
  servicesData,
  therapistsData,
  packagesData,
  Service,
  Therapist,
  FAQItem,
  Testimonial
} from './data';
import VideoGalleryPreview from './videos/VideoGalleryPreview';
import GalleryPreview from './gallery/GalleryPreview';
import { contactDetails, GOOGLE_REVIEWS, whatsappUrl } from './config/business';
import { BUILT_IN_CONTENT, type SiteContent } from './content/useSiteContent';
import AnnouncementStrip from './content/AnnouncementStrip';
import WhatsAppEnquiryLink from './components/WhatsAppEnquiryLink';
import Eyebrow from './components/Eyebrow';
import { COUPLES_EXPERIENCES, naira } from './content/priceList';
import { PRICE_LIST_URL } from './routes';
import MoreDetails from './components/MoreDetails';
import SpaBookingWidget from './components/SpaBookingWidget';
import SiteMenu, { type SiteMenuLink } from './components/SiteMenu';
import BookingSection from './booking/components/LazyBookingSection';
import { BOOKING_HEADING_ID, goToBooking } from './booking/navigation';
import { useSiteCatalog } from './booking/useSiteCatalog';
import type { CatalogPackage, CatalogService } from './services/catalogService';

interface TeamMember {
  id: string;
  name: string;
  role: string;
  imageUrl: string;
}

const teamData: TeamMember[] = [
  { id: 'therapist-1', name: 'Senior Massage Therapist', role: 'Deep Tissue & Swedish Massage', imageUrl: '/assets/images/team/therapist-1.jpg' },
  { id: 'therapist-2', name: 'Lead Spa Therapist', role: 'Hot Stone & Aromatherapy', imageUrl: '/assets/images/team/therapist-2.jpg' },
  { id: 'therapist-3', name: 'Skincare & Facial Specialist', role: 'Facials, Waxing & Skin Treatments', imageUrl: '/assets/images/team/therapist-3.jpg' },
  { id: 'therapist-4', name: 'Wellness Therapist', role: 'Full Body Detox & Reflexology', imageUrl: '/assets/images/team/therapist-4.jpg' },
];

const NAV_LINKS: SiteMenuLink[] = [
  { href: '#about', label: 'About Us' },
  { href: '#services', label: 'Services' },
  { href: PRICE_LIST_URL, label: 'Price List' },
  { href: '#gallery', label: 'Gallery' },
  { href: '#video-gallery', label: 'Video Gallery' },
  { href: '#therapists', label: 'Our Therapists' },
  { href: '#booking', label: 'Book Online', emphasis: true },
  { href: '#faqs', label: 'FAQs' },
];

export default function App({ content = BUILT_IN_CONTENT }: { content?: SiteContent }) {
  const { faqs, gallery, testimonials, announcements, hero } = content;
  const contact = contactDetails();
  // Navigation & Scroll State
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeSection, setActiveTab] = useState<'all' | 'relaxation' | 'therapeutic' | 'sensory'>('all');

  // Hero Slideshow State - cycles between the sanctuary photo and two featured campaign creatives.
  // It holds still while the pointer or keyboard is on it, when the guest pauses it
  // (WCAG 2.2.2), and for guests who ask their device for less motion.
  const [heroSlide, setHeroSlide] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [heroHeld, setHeroHeld] = useState(false);
  const reduceMotion = useReducedMotion();
  const heroSlideCount = 3;
  const heroStill = heroPaused || heroHeld || reduceMotion === true;

  useEffect(() => {
    if (heroStill) return;
    const interval = setInterval(() => {
      setHeroSlide((prev) => (prev + 1) % heroSlideCount);
    }, 6000);
    return () => clearInterval(interval);
  }, [heroStill]);

  // Online booking: the treatment a "Book" button preselects in the funnel
  const [bookingPreselect, setBookingPreselect] = useState<string | null>(null);
  // Treatments and packages for the cards (database catalogue, static fallback)
  const siteCatalog = useSiteCatalog();

  // Accordion FAQ State
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null);

  // Therapist application form
  const [isTherapistModalOpen, setIsTherapistModalOpen] = useState(false);
  const [therapistApplicationSuccess, setTherapistApplicationSuccess] = useState(false);
  const [therapistForm, setTherapistForm] = useState({
    name: '',
    phone: '',
    email: '',
    experience: '1-3',
    specialty: 'Swedish',
    bio: ''
  });

  // Notifications
  const [notification, setNotification] = useState<string | null>(null);

  // Scroll monitoring
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 80) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Quick Notification Helper
  const showToast = (message: string) => {
    setNotification(message);
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // Preselect a treatment in the booking funnel and take the guest there
  const handleQuickBook = (service: CatalogService | CatalogPackage) => {
    if (service.dbId) {
      setBookingPreselect(service.dbId);
      showToast(`Selected ${service.name}. Let's secure your slot!`);
    }
    goToBooking();
  };

  // Therapist application submission
  const handleTherapistSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTherapistApplicationSuccess(true);
    setTimeout(() => {
      setTherapistApplicationSuccess(false);
      setIsTherapistModalOpen(false);
      setTherapistForm({
        name: '',
        phone: '',
        email: '',
        experience: '1-3',
        specialty: 'Swedish',
        bio: ''
      });
      showToast('Application submitted successfully! Our head coordinator will call you.');
    }, 2000);
  };


  // Filter service items by tab
  const filteredServices = activeSection === 'all'
    ? servicesData
    : servicesData.filter(s => s.category.toLowerCase().includes(activeSection.slice(0, 4)));

  return (
    <div className="relative min-h-screen selection:bg-spa-gold selection:text-white">

      {/* Floating viewport-anchored widgets - visible immediately, not scroll-dependent */}
      <SpaBookingWidget />

      {/* Toast Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-spa-charcoal border border-spa-gold text-spa-cream px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 text-sm tracking-wide"
          >
            <Sparkles className="w-4 h-4 text-spa-gold animate-pulse" />
            <span>{notification}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header / Premium Floating Navbar */}
      <header 
        id="masthead"
        className={`fixed top-0 left-0 w-full z-40 transition-all duration-500 ${isScrolled ? 'py-4' : 'py-6'} ${
          isScrolled || isMenuOpen
            ? 'bg-spa-charcoal/95 backdrop-blur-md border-b border-spa-charcoal/20 shadow-lg'
            : 'bg-gradient-to-b from-spa-berry/50 to-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <a href="#" className="flex items-center group flex-shrink-0">
            <img
              src="/assets/images/smm_logo_cropped.png"
              alt="SMM (Sweet Mobile Massage and Spa)"
              className="h-[70px] sm:h-20 lg:h-[88px] w-auto object-contain flex-shrink-0"
            />
          </a>

          {/* Desktop Navigation - the full row needs 1280px; narrower screens use the Menu button */}
          <nav className="hidden xl:flex items-center gap-12 whitespace-nowrap [text-shadow:0_1px_3px_rgba(0,0,0,0.35)]">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className={`text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold transition-colors duration-200 ${link.emphasis ? 'font-medium' : ''}`}>{link.label}</a>
            ))}
          </nav>

          <div className="flex items-center gap-3 sm:gap-4">
            <SiteMenu links={NAV_LINKS} open={isMenuOpen} onOpenChange={setIsMenuOpen} />
            <a 
              href="#booking"
              className="bg-spa-gold hover:bg-spa-gold-dark text-spa-charcoal hover:text-white px-5 py-2.5 text-xs font-semibold uppercase tracking-widest transition-all duration-300 rounded shadow-sm hover:shadow-lg"
            >
              Reserve Slot
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section - a two-slide slideshow: the sanctuary photo, then the featured campaign */}
      <section
        className="relative min-h-[95vh] w-full overflow-hidden bg-spa-charcoal"
        onMouseEnter={() => setHeroHeld(true)}
        onMouseLeave={() => setHeroHeld(false)}
        onFocus={() => setHeroHeld(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeroHeld(false); }}
      >

        {/* Slide 1: Full-bleed sanctuary photo with the primary hero copy. It stays in the
            page flow so the hero grows on short phones instead of clipping its copy; the
            other slides lie over it. */}
        <div
          aria-hidden={heroSlide !== 0}
          className={`relative w-full min-h-[95vh] flex items-center justify-center transition-opacity duration-1000 ease-in-out ${
            heroSlide === 0 ? 'opacity-100 z-[1]' : 'opacity-0 z-0 pointer-events-none'
          }`}
        >
          <img
            src="/assets/images/spa_hero_banner_1783345955168.jpg"
            alt="SMM (Sweet Mobile Massage and Spa) Treatment Sanctuary"
            className="absolute inset-0 w-full h-full object-cover scale-105 select-none brightness-[0.80] contrast-[1.05]"
            fetchPriority="high"
            referrerPolicy="no-referrer"
          />
          {/* Brand gradient wash - darkening scrim for text contrast + the flyer's signature terracotta-to-berry tint */}
          <div className="absolute inset-0 bg-black/30"></div>
          <div className="absolute inset-0 brand-gradient opacity-75"></div>
          <div className="hero-top-scrim" aria-hidden="true"></div>
          <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-spa-cream to-transparent"></div>

          <div className="relative z-10 w-full">
            {/* Top padding clears the logo; bottom padding the slide dots (phones) or the
                "Scroll to Begin" cue (larger screens). On tall screens the copy sits where it always did. */}
            <div className="max-w-5xl mx-auto px-6 text-center text-spa-cream pt-28 pb-14 md:pt-32 md:pb-20">
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1.2, ease: "easeOut" }}
                className="space-y-4 sm:space-y-6"
              >
                <span className="inline-flex items-center gap-2 bg-white/10 border border-spa-gold/50 text-spa-gold text-[10px] sm:text-xs uppercase tracking-[0.2em] font-semibold px-4 py-2 rounded-full backdrop-blur-sm">
                  <BadgePercent className="w-3.5 h-3.5" />
                  First Visit Offer &mdash; 10% Off Your First Booking
                </span>

                <p className="text-spa-gold text-xs lg:text-sm uppercase tracking-[0.3em] font-semibold">
                  Walk-in Luxury & Premium Mobile In-Home Spa
                </p>

                <h1 className="font-serif text-4xl sm:text-5xl md:text-7xl tracking-wide leading-tight font-medium [text-shadow:0_2px_16px_rgba(0,0,0,0.35)]">
                  {hero ? hero.heading : (
                    <>
                      On-Demand Wellness, <br />
                      <span className="italic font-normal">Tranquility</span> on Your Terms.
                    </>
                  )}
                </h1>

                <p className="text-spa-linen/80 max-w-2xl mx-auto text-sm md:text-lg leading-relaxed font-light font-sans tracking-wide">
                  {hero?.subheading ?? 'SMM (Sweet Mobile Massage and Spa) redefines boutique relaxation. Experience pristine walk-in treatments at our safe, secure Lagos sanctuary, or have our qualified master therapists bring the entire spa ritual directly to your doorstep.'}
                </p>

                <div className="pt-5 sm:pt-8 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
                  <a
                    href="#booking"
                    className="w-full sm:w-auto bg-spa-gold hover:bg-spa-gold-dark text-spa-charcoal hover:text-white px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all duration-300 rounded shadow-xl"
                  >
                    Schedule Massage
                  </a>
                  <a
                    href="#services"
                    className="w-full sm:w-auto border border-white/40 hover:bg-white/10 hover:border-white text-white px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all duration-300 rounded backdrop-blur-sm"
                  >
                    Explore Menu
                  </a>
                </div>

                <p className="text-spa-linen/60 text-xs tracking-wide pt-1">
                  Prefer to chat? Message us on WhatsApp &mdash; most replies within minutes.
                </p>
              </motion.div>
            </div>
          </div>
        </div>

        {/* Slide 2: Featured campaign creative - full-bleed, same treatment as the main hero photo */}
        <div
          aria-hidden={heroSlide !== 1}
          className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
            heroSlide === 1 ? 'opacity-100 z-[1]' : 'opacity-0 z-0 pointer-events-none'
          }`}
        >
          <img
            src="/assets/images/smm_promo_tension_to_tranquility.webp"
            alt="SMM Sweet Mobile Massage and Spa promotional campaign: From Tension to Tranquility"
            className="absolute inset-0 w-full h-full object-cover object-[center_65%] select-none"
            referrerPolicy="no-referrer"
          />
          <div className="hero-top-scrim" aria-hidden="true"></div>

          <a
            href="#booking"
            className="absolute bottom-20 md:bottom-28 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-2 bg-spa-gold hover:bg-spa-gold-dark text-spa-charcoal hover:text-white px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all duration-300 rounded shadow-xl whitespace-nowrap"
          >
            Book Your Calm Session Today
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>

        {/* Slide 3: Second featured campaign creative - full-bleed, same treatment as slide 2 */}
        <div
          aria-hidden={heroSlide !== 2}
          className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
            heroSlide === 2 ? 'opacity-100 z-[1]' : 'opacity-0 z-0 pointer-events-none'
          }`}
        >
          <img
            src="/assets/images/hero-slide-2.jpg"
            alt="SMM Sweet Mobile Massage and Spa promotional campaign: Relax Your Body, Calm Your Mind, Renew Your Spirit"
            className="absolute inset-0 w-full h-full object-cover object-[52%_58%] sm:object-[center_62%] select-none"
            referrerPolicy="no-referrer"
          />
          <div className="hero-top-scrim hero-top-scrim--bright" aria-hidden="true"></div>

          <a
            href="#booking"
            className="absolute bottom-20 md:bottom-28 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-2 bg-spa-gold hover:bg-spa-gold-dark text-spa-charcoal hover:text-white px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all duration-300 rounded shadow-xl whitespace-nowrap"
          >
            Book Your Calm Session Today
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>

        {/* Slideshow dot navigation */}
        {/* Each dot's tap area is 44px tall around the small visible dot. */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5">
          {Array.from({ length: heroSlideCount }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setHeroSlide(i)}
              aria-label={`Show hero slide ${i + 1}`}
              aria-current={heroSlide === i ? 'true' : undefined}
              className="group flex h-11 min-w-8 items-center justify-center px-1 focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                className={`block h-1.5 rounded-full transition-all duration-300 group-focus-visible:ring-2 group-focus-visible:ring-spa-gold group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-black/40 ${
                  heroSlide === i ? 'w-6 bg-spa-gold' : 'w-1.5 bg-white/40 group-hover:bg-white/70'
                }`}
              />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setHeroPaused((p) => !p)}
            aria-pressed={heroPaused}
            aria-label={heroPaused ? 'Play the slideshow' : 'Pause the slideshow'}
            className="group flex h-11 w-11 items-center justify-center focus-visible:outline-none"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/50 bg-black/25 text-white transition-colors group-hover:border-spa-gold group-hover:text-spa-gold group-focus-visible:ring-2 group-focus-visible:ring-spa-gold">
              {heroPaused ? <Play className="h-3 w-3 fill-current" aria-hidden="true" /> : <Pause className="h-3 w-3 fill-current" aria-hidden="true" />}
            </span>
          </button>
        </div>

        {/* Minimal indicator */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 hidden md:flex flex-col items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.25em] text-spa-charcoal/60">Scroll to Begin</span>
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
            className="w-1.5 h-1.5 rounded-full bg-spa-gold"
          />
        </div>
      </section>

      <AnnouncementStrip announcements={announcements} />

      {/* Trust & Credibility Bar - the numbers guests look for before they book */}
      <section className="bg-spa-charcoal border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {[
            { icon: Star, label: `${GOOGLE_REVIEWS.rating}★ Average Rating`, sub: `From ${GOOGLE_REVIEWS.count} Google reviews` },
            { icon: Users, label: '1,000+ Happy Clients', sub: 'Served across Lagos' },
            { icon: Award, label: 'Certified Master Therapists', sub: 'Rigorously vetted & trained' },
            { icon: ShieldCheck, label: '100% Hygiene-First Protocol', sub: 'Sanitized tools & fresh linens' }
          ].map((stat, i) => (
            <div key={i} className="flex items-center gap-3 text-center md:text-left md:flex-row flex-col">
              <stat.icon className="w-6 h-6 text-spa-gold flex-shrink-0" />
              <div>
                <p className="text-spa-cream text-xs sm:text-sm font-semibold leading-tight">{stat.label}</p>
                <p className="text-spa-linen/50 text-xs leading-tight mt-0.5">{stat.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* About Section - Introducing the Vibe */}
      <section id="about" className="py-24 bg-spa-cream relative overflow-hidden">
        {/* Decorative blush accent, echoing the flyer's petals */}
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-spa-blush/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-center">
            
            {/* Elegant Column 1: Image Stacks representing the "Bespoke Boutique Vibe" */}
            <div className="lg:col-span-5 relative space-y-4">
              <div className="relative z-10 border border-spa-taupe p-3 bg-white shadow-2xl rounded-sm">
                <video
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="w-full h-[400px] object-cover rounded-sm filter brightness-95"
                >
                  <source src="/assets/videos/walk-in-spa.mp4" type="video/mp4" />
                </video>
              </div>
              <div className="absolute -bottom-8 -right-8 w-1/2 hidden md:block border border-spa-taupe p-2 bg-white shadow-2xl rounded-sm z-20">
                <img
                  src="/assets/images/front-desk-sign.jpg"
                  alt="SMM Spa And Massage front desk signage - Sweet Mobile Massage"
                  className="w-full h-48 object-cover object-center rounded-sm"
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>

            {/* Column 2: Text detail focusing on aesthetic luxury */}
            <div className="lg:col-span-7 space-y-8">
              <div className="space-y-4">
                <Eyebrow align="start">The SMM Vibe</Eyebrow>
                <h2 className="font-serif text-3xl md:text-5xl leading-tight text-spa-charcoal">
                  A sanctuary designed for absolute <span className="italic">sensory</span> reboot.
                </h2>
              </div>

              <div className="text-spa-clay-text leading-relaxed space-y-6 font-light">
                <p>
                  At SMM (Sweet Mobile Massage and Spa), we believe relaxation shouldn't be high-effort. We seamlessly bridge the gap between premium medical-grade muscle care and traditional peaceful day spa atmospheres.
                </p>
                <p>
                  Our boutique sanctuary in <strong>Mende, Maryland, Lagos</strong> features private secure therapy suites, climate-controlled rooms, heated tables, and pure therapeutic aromatherapy. For those seeking relaxation without commuting, our mobile fleet transports this exact luxury experience—including premium heated volcanic stones, specialized sheets, and soft ambient sounds—straight to your private residence.
                </p>
              </div>

              {/* Bento-style highlights */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-spa-linen border border-spa-taupe flex items-center justify-center text-spa-gold">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-serif text-lg font-medium text-spa-charcoal">Qualified Master Therapists</h4>
                    <p className="text-xs text-spa-clay-text mt-1">Rigorously selected, vetted, and specialized in precise kinesiology and sensory rituals.</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-spa-linen border border-spa-taupe flex items-center justify-center text-spa-gold">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-serif text-lg font-medium text-spa-charcoal">Ultimate Discretion & Safety</h4>
                    <p className="text-xs text-spa-clay-text mt-1">We enforce meticulous hygiene standards and guarantee private, quiet experiences.</p>
                  </div>
                </div>
              </div>

              {/* Consistency guarantee callout */}
              <div className="flex items-center gap-4 bg-spa-linen border border-spa-taupe rounded p-5">
                <CheckCircle2 className="w-8 h-8 text-spa-gold flex-shrink-0" />
                <p className="text-xs text-spa-clay-text leading-relaxed">
                  <strong className="text-spa-charcoal font-semibold">Our Consistency Promise:</strong> the same calming, high standard of care every visit — regardless of which of our therapists attends to you.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Services Section - The Curated Menu */}
      <section id="services" className="py-24 bg-spa-linen border-y border-spa-taupe relative overflow-hidden">
        {/* Decorative blush accent, echoing the flyer's petals */}
        <div className="absolute -bottom-32 -left-24 w-96 h-96 bg-spa-blush/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="max-w-7xl mx-auto px-6">

          {/* Section Header */}
          <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
            <Eyebrow>Curated Therapy</Eyebrow>
            <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal">Our <span className="italic">Healing</span> Services</h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
            <p className="text-spa-clay-text text-sm font-light mt-4">
              Carefully crafted therapies to heal muscular distress, enhance deep sleep, and re-establish physical tranquility.
            </p>
          </div>

          {/* Service Cards Grid - Elegant, minimal cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {siteCatalog.services.map((service) => (
              <div 
                key={service.id}
                className="bg-white border border-spa-taupe overflow-hidden flex flex-col justify-between hover:shadow-xl transition-all duration-300 rounded group"
              >
                <div>
                  {/* Service Image banner */}
                  <div className="relative h-44 sm:h-56 overflow-hidden">
                    <img 
                      src={service.imageUrl} 
                      alt={service.name} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 brightness-95"
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute top-4 left-4 bg-spa-charcoal/80 text-spa-gold text-[10px] uppercase tracking-widest px-3 py-1 rounded backdrop-blur-sm">
                      {service.category}
                    </div>
                    <div className="absolute bottom-4 right-4 bg-white text-spa-charcoal text-xs font-bold px-3 py-1.5 rounded shadow-md">
                      {service.duration} mins
                    </div>
                  </div>

                  {/* Service Text Detail */}
                  <div className="p-5 sm:p-7 space-y-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-spa-taupe pb-3">
                      <h3 className="font-serif text-xl sm:text-2xl text-spa-charcoal font-medium">{service.name}</h3>
                      <span className="text-spa-gold-dark font-serif text-xl sm:text-2xl font-light">{service.formattedPrice}</span>
                    </div>

                    <p className="text-sm text-spa-clay-text font-light leading-relaxed">
                      {service.description}
                    </p>

                    {/* Benefits: folded away so the cards stay compact */}
                    <MoreDetails label="Key benefits" items={service.benefits} />
                  </div>
                </div>

                {/* Card footer book CTA */}
                <div className="p-5 sm:p-7 pt-0 sm:pt-0">
                  <button 
                    onClick={() => handleQuickBook(service)}
                    className="w-full bg-spa-charcoal hover:bg-spa-gold text-spa-cream hover:text-spa-charcoal py-3.5 text-xs font-bold uppercase tracking-widest transition-all duration-300 rounded border border-spa-charcoal/20"
                  >
                    Select & Customize Booking
                  </button>
                  <WhatsAppEnquiryLink name={service.name} details={[`${service.duration} mins`, service.formattedPrice]} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-14 flex flex-col items-center gap-5 text-center">
            <p className="text-xs text-spa-clay-text italic flex items-center justify-center gap-2">
              <Info className="w-4 h-4 text-spa-gold-dark flex-shrink-0" aria-hidden="true" />
              <span>Massage sessions run 50 minutes to 1 hour. We offer over 40 treatments, including facials, pedicures, body scrubs and waxing.</span>
            </p>
            <a
              href={PRICE_LIST_URL}
              className="inline-flex min-h-11 items-center gap-2 rounded border border-spa-charcoal px-7 py-3 text-xs font-bold uppercase tracking-widest text-spa-charcoal transition-colors hover:bg-spa-charcoal hover:text-spa-cream"
            >
              View the full price list
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>

        </div>
      </section>

      {/* Couples & Four Hands - two therapists at once, so booked on WhatsApp (online
          booking reserves one therapist per appointment) */}
      <section id="packages" className="py-24 bg-spa-cream relative">
        <div className="max-w-7xl mx-auto px-6">

          <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
            <Eyebrow>Share the Calm</Eyebrow>
            <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal">Couples &amp; <span className="italic">Four Hands</span></h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
            <p className="text-spa-clay-text text-sm font-light mt-4">
              Two therapists at once: side by side with someone special, or both working on you. 65-minute sessions, booked with our team on WhatsApp so both therapists are reserved for you.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {COUPLES_EXPERIENCES.map((exp) => (
              <div
                key={exp.id}
                className={`relative bg-white border rounded overflow-hidden flex flex-col justify-between transition-all duration-300 ${
                  exp.popular
                    ? 'border-spa-gold shadow-2xl md:-translate-y-3'
                    : 'border-spa-taupe hover:shadow-xl'
                }`}
              >
                {exp.popular && (
                  <div className="absolute top-4 right-4 bg-spa-gold text-spa-charcoal text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full z-10">
                    Most Popular
                  </div>
                )}

                <div className="relative h-36 sm:h-48 overflow-hidden">
                  <img
                    src={exp.imageUrl}
                    alt=""
                    className="w-full h-full object-cover brightness-95"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                </div>

                <div className="p-5 sm:p-8 space-y-4 sm:space-y-5 flex-1">
                  <div className="space-y-1 border-b border-spa-taupe pb-4">
                    <h3 className="font-serif text-2xl text-spa-charcoal font-medium">{exp.name}</h3>
                    <p className="text-xs text-spa-clay-text">{exp.duration} mins · two therapists</p>
                  </div>

                  <p className="text-sm text-spa-clay-text font-light leading-relaxed">{exp.description}</p>

                  <p className="font-serif text-3xl font-semibold text-spa-gold-dark pt-2">{naira(exp.price)}</p>
                </div>

                <div className="p-5 sm:p-8 pt-0 sm:pt-0">
                  <a
                    href={whatsappUrl(`Hello, I would like to book the ${exp.name} (${exp.duration} mins, ${naira(exp.price)}). Please let me know the available times.`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex w-full items-center justify-center gap-2 py-3.5 text-xs font-bold uppercase tracking-widest transition-all duration-300 rounded border ${
                      exp.popular
                        ? 'bg-spa-gold hover:bg-spa-gold-dark text-spa-charcoal hover:text-white border-spa-gold'
                        : 'bg-spa-charcoal hover:bg-spa-gold text-spa-cream hover:text-spa-charcoal border-spa-charcoal/20'
                    }`}
                  >
                    Book on WhatsApp
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Online Booking Wizard - Interactive Luxury Scheduler */}
      <section id="booking" className="py-24 bg-spa-cream relative">
        <div className="max-w-4xl mx-auto px-6">
          
          {/* Section Header */}
          <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
            <Eyebrow>Seamless Reservation</Eyebrow>
            <h2 id={BOOKING_HEADING_ID} tabIndex={-1} className="font-serif text-3xl md:text-5xl text-spa-charcoal focus:outline-none">Schedule Your <span className="italic">Therapy</span></h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
            <p className="text-spa-clay-text text-sm font-light mt-4">
              Enter your preferences below to calculate prices transparently, select a therapist, and lock in your session slot.
            </p>
          </div>

          {/* Online booking: availability, reservation and payment through the booking system */}
          <BookingSection preselectServiceId={bookingPreselect} />
        </div>
      </section>

      <GalleryPreview gallery={gallery} />

      <VideoGalleryPreview />

      {/* Meet Our Therapists Section */}
      <section id="therapists" className="py-24 bg-spa-linen border-t border-spa-taupe relative">
        <div className="max-w-7xl mx-auto px-6">

          {/* Section Header */}
          <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
            <Eyebrow>The Hands Behind The Ritual</Eyebrow>
            <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal">Meet Our <span className="italic">Therapists</span></h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
            <p className="text-spa-clay-text text-sm font-light mt-4">
              Certified master therapists dedicated to bringing boutique-quality care to every session, at our sanctuary or at your doorstep.
            </p>
          </div>

          {/* Team Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {teamData.map((member) => (
              <div
                key={member.id}
                className="group relative overflow-hidden border border-spa-taupe bg-white p-2 rounded shadow-sm hover:shadow-2xl transition-all duration-300"
              >
                <div className="relative aspect-[4/5] overflow-hidden rounded-sm bg-spa-charcoal">
                  <img
                    src={member.imageUrl}
                    alt={member.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 brightness-95"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="pt-4 pb-2 px-1 text-center">
                  <span className="block font-serif text-base text-spa-charcoal font-medium">{member.name}</span>
                  <span className="block text-[10px] uppercase tracking-wider text-spa-gold-dark font-bold mt-1">
                    {member.role}
                  </span>
                </div>
              </div>
            ))}
          </div>

        </div>
      </section>


      {/* Testimonials Grid / Guest Reviews - only real, published reviews; hidden until there is one */}
      {testimonials.length > 0 && (
      <section className="py-24 bg-spa-linen border-t border-spa-taupe relative overflow-hidden">
        {/* Decorative blush accent, echoing the flyer's petals */}
        <div className="absolute -top-20 -left-20 w-80 h-80 bg-spa-blush/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
            <Eyebrow>Guest Experiences</Eyebrow>
            <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal"><span className="italic">Tranquil</span> Feedback</h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
            {/* The spa's Google rating: what guests say on its Google Business listing */}
            <p className="flex items-center justify-center gap-2 pt-2 text-sm text-spa-clay-text">
              <span className="font-serif text-2xl text-spa-charcoal">{GOOGLE_REVIEWS.rating}</span>
              <span aria-hidden="true" className="text-spa-gold-dark tracking-wider">★★★★★</span>
              <span>from {GOOGLE_REVIEWS.count} Google reviews</span>
            </p>
          </div>

          {/* Centred rows of up to three: a short last row stays centred */}
          <div className="flex flex-wrap justify-center gap-8">
            {testimonials.map((test) => (
              <div 
                key={test.id}
                className="w-full md:w-[calc((100%-4rem)/3)] bg-white border border-spa-taupe p-8 rounded shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between"
              >
                <div className="space-y-4">
                  {/* Rating gold stars */}
                  <div className="flex gap-1" role="img" aria-label={`${test.rating} out of 5 stars`}>
                    {[...Array(test.rating)].map((_, i) => (
                      <span key={i} aria-hidden="true" className="text-spa-gold-dark font-bold">★</span>
                    ))}
                  </div>
                  {/* Word for word, keeping the reviewer's own line breaks */}
                  <p className="text-sm text-spa-clay-text font-light leading-relaxed italic whitespace-pre-line">
                    "{test.text}"
                  </p>
                </div>
                <div className="border-t border-spa-taupe/60 pt-4 mt-6 flex justify-between items-center text-xs">
                  <div>
                    <span className="font-bold text-spa-charcoal block">{test.name}</span>
                    <span className="text-spa-clay-text font-light block">{test.location}</span>
                  </div>
                  {test.serviceName && (
                    <span className="text-[10px] bg-spa-linen border border-spa-taupe px-2.5 py-1 rounded-full text-spa-clay-text uppercase tracking-widest font-semibold">
                      {test.serviceName}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <a
              href={GOOGLE_REVIEWS.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded border border-spa-charcoal px-7 py-3 text-xs font-bold uppercase tracking-widest text-spa-charcoal transition-colors hover:bg-spa-charcoal hover:text-spa-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spa-gold-dark focus-visible:ring-offset-2"
            >
              Read all {GOOGLE_REVIEWS.count} reviews on Google{' '}
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </div>
      </section>
      )}

      {/* Gift Cards & Membership - the two proven revenue/loyalty levers our top-performing peers all use */}
      <section className="py-24 bg-spa-charcoal relative">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-8">

          {/* Gift Cards */}
          <div className="bg-white/5 border border-white/10 rounded p-10 space-y-5">
            <div className="w-12 h-12 rounded-full bg-spa-gold/15 border border-spa-gold/40 flex items-center justify-center text-spa-gold">
              <Gift className="w-6 h-6" />
            </div>
            <h3 className="font-serif text-2xl md:text-3xl text-spa-cream">Gift the <span className="italic">Ritual</span></h3>
            <p className="text-sm text-spa-linen/70 font-light leading-relaxed">
              An SMM Gift Card is available in any amount, redeemable on both sanctuary and mobile bookings, and never expires. Better than flowers.
            </p>
            <a
              href={whatsappUrl("Hi! I'd like to purchase an SMM (Sweet Mobile Massage and Spa) gift card.")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-spa-gold hover:bg-spa-gold-dark text-spa-charcoal hover:text-white px-6 py-3 text-xs font-bold uppercase tracking-widest transition-all duration-300 rounded"
            >
              <Gift className="w-4 h-4" />
              Buy a Gift Card
            </a>
          </div>

          {/* Membership / Loyalty teaser */}
          <div className="bg-white/5 border border-white/10 rounded p-10 space-y-5">
            <div className="w-12 h-12 rounded-full bg-spa-gold/15 border border-spa-gold/40 flex items-center justify-center text-spa-gold">
              <Crown className="w-6 h-6" />
            </div>
            <h3 className="font-serif text-2xl md:text-3xl text-spa-cream">Join the SMM <span className="italic">Wellness</span> Circle</h3>
            <ul className="space-y-2">
              {[
                'Priority booking access, even in peak periods',
                'Member-only pricing on couples and four-hands massages',
                'A complimentary treat on your birthday month'
              ].map((perk, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-spa-linen/70 font-light">
                  <Check className="w-3.5 h-3.5 text-spa-gold mt-1 flex-shrink-0" />
                  <span>{perk}</span>
                </li>
              ))}
            </ul>
            <a
              href={whatsappUrl("Hi! I'd like to join the SMM Wellness Circle membership.")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 border border-spa-gold/60 hover:bg-spa-gold hover:text-spa-charcoal text-spa-gold px-6 py-3 text-xs font-bold uppercase tracking-widest transition-all duration-300 rounded"
            >
              <Crown className="w-4 h-4" />
              Ask About Membership
            </a>
          </div>

        </div>
      </section>

      {/* FAQ Accordion Section */}
      <section id="faqs" className="py-24 bg-spa-cream border-t border-spa-taupe relative">
        <div className="max-w-3xl mx-auto px-6">
          
          {/* Section Header */}
          <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
            <Eyebrow>Clear Guidance</Eyebrow>
            <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal">Frequently <span className="italic">Asked</span> Questions</h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
          </div>

          {/* Accordion Container */}
          <div className="space-y-4">
            {faqs.map((faq) => (
              <div 
                key={faq.id}
                className="bg-white border border-spa-taupe rounded overflow-hidden shadow-sm"
              >
                <button 
                  onClick={() => setExpandedFaq(expandedFaq === faq.id ? null : faq.id)}
                  className="w-full p-6 text-left flex justify-between items-center gap-4 focus:outline-none hover:bg-spa-linen/30 transition-colors"
                >
                  <span className="font-serif text-base sm:text-lg text-spa-charcoal font-medium">
                    {faq.question}
                  </span>
                  <span className="text-spa-gold flex-shrink-0">
                    {expandedFaq === faq.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {expandedFaq === faq.id && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-spa-taupe/40 bg-spa-cream/10"
                    >
                      <div className="p-6 text-sm text-spa-clay-text font-light leading-relaxed space-y-2">
                        {Array.isArray(faq.answer) ? (
                          faq.answer.map((ans, idx) => (
                            <p key={idx}>{ans}</p>
                          ))
                        ) : (
                          <p>{faq.answer}</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* THERAPIST APPLICATION MODAL */}
      <AnimatePresence>
        {isTherapistModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-spa-charcoal/90 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white border border-spa-taupe rounded-lg shadow-2xl p-6 sm:p-8 max-w-lg w-full relative"
            >
              <button 
                onClick={() => setIsTherapistModalOpen(false)}
                className="absolute top-4 right-4 text-spa-clay-text hover:text-spa-charcoal"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="space-y-4 mb-6">
                <h3 className="font-serif text-2xl text-spa-charcoal">Join the SMM Therapist Collective</h3>
                <p className="text-xs text-spa-clay-text leading-normal">
                  Are you a certified, highly professional massage therapist? Provide your contact details and specialty to join Nigeria's premium hybrid spa crew.
                </p>
              </div>

              {therapistApplicationSuccess ? (
                <div className="py-8 text-center space-y-3">
                  <CheckCircle2 className="w-12 h-12 text-spa-gold mx-auto animate-bounce" />
                  <h4 className="font-serif text-lg font-bold text-spa-charcoal">Application Submitted!</h4>
                  <p className="text-xs text-spa-clay-text">Our head clinical coordinator will reach out within 48 hours.</p>
                </div>
              ) : (
                <form onSubmit={handleTherapistSubmit} className="space-y-4 text-xs">
                  <div className="space-y-1">
                    <label className="block text-xs uppercase tracking-wider font-bold text-spa-charcoal">Full Name</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. Esther Olaitan"
                      value={therapistForm.name}
                      onChange={(e) => setTherapistForm({...therapistForm, name: e.target.value})}
                      className="w-full bg-spa-cream/30 border border-spa-taupe text-spa-charcoal text-sm p-3 focus:outline-none focus:border-spa-gold rounded"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-xs uppercase tracking-wider font-bold text-spa-charcoal">Email Address</label>
                      <input 
                        type="email" 
                        required
                        placeholder="name@domain.com"
                        value={therapistForm.email}
                        onChange={(e) => setTherapistForm({...therapistForm, email: e.target.value})}
                        className="w-full bg-spa-cream/30 border border-spa-taupe text-spa-charcoal text-sm p-3 focus:outline-none focus:border-spa-gold rounded"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs uppercase tracking-wider font-bold text-spa-charcoal">Phone Number</label>
                      <input 
                        type="tel" 
                        required
                        placeholder="+234..."
                        value={therapistForm.phone}
                        onChange={(e) => setTherapistForm({...therapistForm, phone: e.target.value})}
                        className="w-full bg-spa-cream/30 border border-spa-taupe text-spa-charcoal text-sm p-3 focus:outline-none focus:border-spa-gold rounded"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-xs uppercase tracking-wider font-bold text-spa-charcoal">Primary Specialty</label>
                      <select 
                        value={therapistForm.specialty}
                        onChange={(e) => setTherapistForm({...therapistForm, specialty: e.target.value})}
                        className="w-full bg-white border border-spa-taupe text-spa-charcoal text-sm p-3 focus:outline-none focus:border-spa-gold rounded"
                      >
                        <option value="Swedish">Swedish Massage</option>
                        <option value="Deep Tissue">Deep Tissue Therapy</option>
                        <option value="Hot Stone">Hot Stone Rituals</option>
                        <option value="Nuru">Nuru & Sensory Therapy</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs uppercase tracking-wider font-bold text-spa-charcoal">Years of Experience</label>
                      <select 
                        value={therapistForm.experience}
                        onChange={(e) => setTherapistForm({...therapistForm, experience: e.target.value})}
                        className="w-full bg-white border border-spa-taupe text-spa-charcoal text-sm p-3 focus:outline-none focus:border-spa-gold rounded"
                      >
                        <option value="1-3">1 - 3 Years</option>
                        <option value="3-5">3 - 5 Years</option>
                        <option value="5+">5+ Years</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs uppercase tracking-wider font-bold text-spa-charcoal">Brief bio & background summary</label>
                    <textarea 
                      rows={3}
                      required
                      placeholder="List your previous spa employment or certifications..."
                      value={therapistForm.bio}
                      onChange={(e) => setTherapistForm({...therapistForm, bio: e.target.value})}
                      className="w-full bg-spa-cream/30 border border-spa-taupe text-spa-charcoal text-sm p-3 focus:outline-none focus:border-spa-gold rounded resize-none"
                    />
                  </div>

                  <button 
                    type="submit"
                    className="w-full bg-spa-charcoal hover:bg-spa-gold text-spa-cream hover:text-spa-charcoal p-3.5 rounded text-xs font-bold uppercase tracking-widest transition-all"
                  >
                    Submit Application
                  </button>
                </form>
              )}

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Immersive Footer */}
      <footer id="colophon" className="bg-spa-charcoal text-spa-cream relative border-t border-white/5 overflow-hidden">
        {/* Brand gradient accent stripe + decorative blush glow */}
        <div className="absolute top-0 left-0 w-full h-1 brand-gradient"></div>
        <div className="absolute -bottom-24 right-0 w-96 h-96 bg-spa-blush/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="max-w-7xl mx-auto px-6 py-16">
          
          <div className="grid grid-cols-1 md:grid-cols-12 gap-12 items-start">
            
            {/* Column 1: Brand & Tagline */}
            <div className="md:col-span-4 space-y-4">
              <div
                className="footer-logo h-24 sm:h-28 w-auto"
                role="img"
                aria-label="SMM (Sweet Mobile Massage and Spa)"
              ></div>
              <p className="text-xs text-spa-linen/70 font-light leading-relaxed max-w-xs">
                Premium walks-in day spa sanctuary & custom on-demand in-home mobile therapies. Qualified hands selected to work strictly on your terms.
              </p>
              <div className="pt-1 -ml-3.5 flex text-spa-linen/80">
                {/* Only the spa's own Instagram: the Facebook and X icons linked to those sites' home pages, not to SMM. */}
                <a href="https://www.instagram.com/oges.vlog_spa/" target="_blank" rel="noopener noreferrer" aria-label="SMM on Instagram" className="flex h-11 w-11 items-center justify-center hover:text-spa-gold transition-colors"><Instagram className="w-4 h-4" aria-hidden="true" /></a>
                <a href="https://t.me/sweet_mobile_massage" target="_blank" rel="noopener noreferrer" aria-label="SMM on Telegram" className="flex h-11 w-11 items-center justify-center hover:text-spa-gold transition-colors"><Send className="w-4 h-4" aria-hidden="true" /></a>
              </div>
            </div>

            {/* Column 2: Navigation Links */}
            <div className="md:col-span-2 space-y-4 text-xs">
              <h4 className="uppercase tracking-widest font-semibold text-spa-gold text-xs">Quick Navigation</h4>
              <ul className="-my-2.5 font-light text-spa-linen/80">
                <li><a href="#" className="inline-flex min-h-11 items-center hover:text-spa-gold transition-colors">Home Base</a></li>
                <li><a href="#about" className="inline-flex min-h-11 items-center hover:text-spa-gold transition-colors">About the Spa</a></li>
                <li><a href="#services" className="inline-flex min-h-11 items-center hover:text-spa-gold transition-colors">Therapy Menu</a></li>
                <li><a href="#packages" className="inline-flex min-h-11 items-center hover:text-spa-gold transition-colors">Couples &amp; Four Hands</a></li>
                <li><a href={PRICE_LIST_URL} className="inline-flex min-h-11 items-center hover:text-spa-gold transition-colors">Full Price List</a></li>
                <li><a href="#gallery" className="inline-flex min-h-11 items-center hover:text-spa-gold transition-colors">Interactive Gallery</a></li>
                <li><a href="#booking" className="inline-flex min-h-11 items-center hover:text-spa-gold transition-colors">Secure a Slot</a></li>
              </ul>
            </div>

            {/* Column 3: Contact details */}
            <div className="md:col-span-3 space-y-4 text-xs">
              <h4 className="uppercase tracking-widest font-semibold text-spa-gold text-xs">Contact Info</h4>
              <ul className="space-y-1 font-light text-spa-linen/80">
                {contact.email && (
                  <li className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-spa-gold flex-shrink-0" />
                    <a href={`mailto:${contact.email}`} className="inline-flex min-h-11 items-center hover:text-spa-gold transition-colors">{contact.email}</a>
                  </li>
                )}
                <li className="flex items-center gap-x-2 flex-wrap">
                  <Phone className="w-3.5 h-3.5 text-spa-gold flex-shrink-0" />
                  <a href={`tel:${contact.phone.tel}`} className="inline-flex min-h-11 items-center hover:text-spa-gold transition-colors">{contact.phone.display}</a>
                  {[contact.phoneSecondary, contact.phoneThird].map((p) => p && (
                    <span key={p.tel} className="contents">
                      <span className="text-spa-linen/40" aria-hidden="true">/</span>
                      <a href={`tel:${p.tel}`} className="inline-flex min-h-11 items-center hover:text-spa-gold transition-colors">{p.display}</a>
                    </span>
                  ))}
                </li>
                {contact.address && (
                  <li className="flex items-start gap-2 leading-relaxed">
                    <MapPin className="w-3.5 h-3.5 text-spa-gold flex-shrink-0 mt-0.5" />
                    <span>{contact.address}</span>
                  </li>
                )}
              </ul>
            </div>

            {/* Column 4: Apply to be therapist CTA */}
            <div className="md:col-span-3 space-y-4 text-xs">
              <h4 className="uppercase tracking-widest font-semibold text-spa-gold text-xs">Join Our Crew</h4>
              <p className="text-xs text-spa-linen/70 font-light leading-relaxed">
                Certified therapist looking to work in luxury conditions on your own schedule?
              </p>
              <button 
                onClick={() => {
                  setTherapistApplicationSuccess(false);
                  setIsTherapistModalOpen(true);
                }}
                className="w-full bg-spa-gold hover:bg-spa-gold-dark text-spa-charcoal hover:text-white py-3 text-xs font-bold uppercase tracking-widest transition-all rounded"
              >
                Become an SMM Therapist
              </button>
            </div>

          </div>

          <div className="border-t border-white/5 mt-16 pt-8 text-center text-xs text-spa-linen/60 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p>Copyright © 2026 SMM (Sweet Mobile Massage and Spa). All Rights Reserved.</p>
            <p className="font-light">
              Designed with 🤍 for a Premium Sensory Experience
            </p>
          </div>

        </div>
      </footer>

    </div>
  );
}
