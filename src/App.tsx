import React, { useState, useEffect } from 'react';
import { 
  motion, 
  AnimatePresence 
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
  Facebook, 
  Twitter, 
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
  Send
} from 'lucide-react';
import {
  servicesData,
  therapistsData,
  galleryData,
  testimonialsData,
  faqsData,
  packagesData,
  Service,
  Therapist,
  FAQItem,
  GalleryItem,
  Testimonial
} from './data';
import VideoGalleryPreview from './videos/VideoGalleryPreview';
import { PHONE_DISPLAY, PHONE_E164, whatsappUrl } from './config/business';
import WhatsAppEnquiryLink from './components/WhatsAppEnquiryLink';
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
  { href: '#packages', label: 'Packages' },
  { href: '#gallery', label: 'Gallery' },
  { href: '#video-gallery', label: 'Video Gallery' },
  { href: '#therapists', label: 'Our Therapists' },
  { href: '#booking', label: 'Book Online', emphasis: true },
  { href: '#faqs', label: 'FAQs' },
];

export default function App() {
  // Navigation & Scroll State
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeSection, setActiveTab] = useState<'all' | 'relaxation' | 'therapeutic' | 'sensory'>('all');

  // Hero Slideshow State - cycles between the sanctuary photo and two featured campaign creatives
  const [heroSlide, setHeroSlide] = useState(0);
  const heroSlideCount = 3;

  useEffect(() => {
    const interval = setInterval(() => {
      setHeroSlide((prev) => (prev + 1) % heroSlideCount);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  // Online booking: the treatment a "Book" button preselects in the funnel
  const [bookingPreselect, setBookingPreselect] = useState<string | null>(null);
  // Treatments and packages for the cards (database catalogue, static fallback)
  const siteCatalog = useSiteCatalog();

  // Gallery Filters & Lightbox
  const [activeGalleryFilter, setActiveGalleryFilter] = useState<'all' | 'sanctuary' | 'treatments' | 'therapy'>('all');
  const [activeLightboxImage, setActiveLightboxImage] = useState<GalleryItem | null>(null);

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

  // Filter gallery items
  const filteredGallery = activeGalleryFilter === 'all'
    ? galleryData
    : galleryData.filter(item => item.category === activeGalleryFilter);

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
      <section className="relative min-h-[95vh] w-full overflow-hidden bg-spa-charcoal">

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
            <div className="max-w-5xl mx-auto px-6 text-center text-spa-cream pt-28 pb-8 md:pt-32 md:pb-20">
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
                  On-Demand Wellness, <br />
                  <span className="italic font-normal">Tranquility</span> on Your Terms.
                </h1>

                <p className="text-spa-linen/80 max-w-2xl mx-auto text-sm md:text-lg leading-relaxed font-light font-sans tracking-wide">
                  SMM (Sweet Mobile Massage and Spa) redefines boutique relaxation. Experience pristine walk-in treatments at our safe, secure Lagos sanctuary, or have our qualified master therapists bring the entire spa ritual directly to your doorstep.
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

                <p className="text-spa-linen/60 text-[11px] sm:text-xs tracking-wide pt-1">
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
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
          {Array.from({ length: heroSlideCount }).map((_, i) => (
            <button
              key={i}
              onClick={() => setHeroSlide(i)}
              aria-label={`Show hero slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                heroSlide === i ? 'w-6 bg-spa-gold' : 'w-1.5 bg-white/40 hover:bg-white/70'
              }`}
            />
          ))}
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

      {/* Trust & Credibility Bar - the numbers guests look for before they book */}
      <section className="bg-spa-charcoal border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {[
            { icon: Star, label: '4.9★ Average Rating', sub: 'From verified guest reviews' },
            { icon: Users, label: '1,000+ Happy Clients', sub: 'Served across Lagos' },
            { icon: Award, label: 'Certified Master Therapists', sub: 'Rigorously vetted & trained' },
            { icon: ShieldCheck, label: '100% Hygiene-First Protocol', sub: 'Sanitized tools & fresh linens' }
          ].map((stat, i) => (
            <div key={i} className="flex items-center gap-3 text-center md:text-left md:flex-row flex-col">
              <stat.icon className="w-6 h-6 text-spa-gold flex-shrink-0" />
              <div>
                <p className="text-spa-cream text-xs sm:text-sm font-semibold leading-tight">{stat.label}</p>
                <p className="text-spa-linen/50 text-[10px] leading-tight mt-0.5">{stat.sub}</p>
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
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>

            {/* Column 2: Text detail focusing on aesthetic luxury */}
            <div className="lg:col-span-7 space-y-8">
              <div className="space-y-4">
                <span className="text-spa-gold text-xs uppercase tracking-[0.3em] font-semibold block">The SMM Vibe</span>
                <h2 className="font-serif text-3xl md:text-5xl leading-tight text-spa-charcoal">
                  A sanctuary designed for absolute <span className="italic">sensory</span> reboot.
                </h2>
              </div>

              <div className="text-spa-clay leading-relaxed space-y-6 font-light">
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
                    <p className="text-xs text-spa-clay/80 mt-1">Rigorously selected, vetted, and specialized in precise kinesiology and sensory rituals.</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-spa-linen border border-spa-taupe flex items-center justify-center text-spa-gold">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-serif text-lg font-medium text-spa-charcoal">Ultimate Discretion & Safety</h4>
                    <p className="text-xs text-spa-clay/80 mt-1">We enforce meticulous hygiene standards and guarantee private, quiet experiences.</p>
                  </div>
                </div>
              </div>

              {/* Consistency guarantee callout */}
              <div className="flex items-center gap-4 bg-spa-linen border border-spa-taupe rounded p-5">
                <CheckCircle2 className="w-8 h-8 text-spa-gold flex-shrink-0" />
                <p className="text-xs text-spa-clay leading-relaxed">
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
            <span className="text-spa-gold text-xs uppercase tracking-[0.3em] font-semibold block">Curated Therapy</span>
            <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal">Our <span className="italic">Healing</span> Services</h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
            <p className="text-spa-clay text-sm font-light mt-4">
              Carefully conceptualized 60-minute therapies to heal muscular distress, enhance deep sleep, and re-establish physical tranquility.
            </p>
          </div>

          {/* Service Cards Grid - Elegant, minimal cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
            {siteCatalog.services.map((service) => (
              <div 
                key={service.id}
                className="bg-white border border-spa-taupe overflow-hidden flex flex-col justify-between hover:shadow-xl transition-all duration-300 rounded group"
              >
                <div>
                  {/* Service Image banner */}
                  <div className="relative h-64 overflow-hidden">
                    <img 
                      src={service.imageUrl} 
                      alt={service.name} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 brightness-95"
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
                  <div className="p-8 space-y-6">
                    <div className="flex items-baseline justify-between border-b border-spa-taupe pb-4">
                      <h3 className="font-serif text-2xl text-spa-charcoal font-medium">{service.name}</h3>
                      <span className="text-spa-gold-dark font-serif text-2xl font-light">{service.formattedPrice}</span>
                    </div>

                    <p className="text-sm text-spa-clay/90 font-light leading-relaxed">
                      {service.description}
                    </p>

                    {/* Benefits bullet points */}
                    <div className="space-y-2 pt-2">
                      <h4 className="text-xs uppercase tracking-wider text-spa-charcoal font-semibold">Key Benefits:</h4>
                      <ul className="space-y-2">
                        {service.benefits.map((benefit, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-xs text-spa-clay">
                            <Check className="w-3.5 h-3.5 text-spa-gold mt-0.5 flex-shrink-0" />
                            <span>{benefit}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Card footer book CTA */}
                <div className="p-8 pt-0">
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

          <div className="mt-16 text-center text-xs text-spa-clay italic flex items-center justify-center gap-2">
            <Info className="w-4 h-4 text-spa-gold" />
            <span>All therapies can be custom prolonged to 90 or 120 minutes. Simply coordinate with your assigned therapist.</span>
          </div>

        </div>
      </section>

      {/* Signature Packages - bundled therapies at a discount, our highest-value offers */}
      <section id="packages" className="py-24 bg-spa-cream relative">
        <div className="max-w-7xl mx-auto px-6">

          <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
            <span className="text-spa-gold text-xs uppercase tracking-[0.3em] font-semibold block">Bundle & Save</span>
            <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal"><span className="italic">Signature</span> Packages</h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
            <p className="text-spa-clay text-sm font-light mt-4">
              Combine our most-loved therapies into one extended sanctuary visit — curated for deeper results and better value.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {siteCatalog.packages.map((pkg) => (
              <div
                key={pkg.id}
                className={`relative bg-white border rounded overflow-hidden flex flex-col justify-between transition-all duration-300 ${
                  pkg.popular
                    ? 'border-spa-gold shadow-2xl md:-translate-y-3'
                    : 'border-spa-taupe hover:shadow-xl'
                }`}
              >
                {pkg.popular && (
                  <div className="absolute top-4 right-4 bg-spa-gold text-spa-charcoal text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full z-10">
                    Most Popular
                  </div>
                )}

                <div className="relative h-48 overflow-hidden">
                  <img
                    src={pkg.imageUrl}
                    alt={pkg.name}
                    className="w-full h-full object-cover brightness-95"
                    referrerPolicy="no-referrer"
                  />
                </div>

                <div className="p-8 space-y-5 flex-1">
                  <div className="space-y-1 border-b border-spa-taupe pb-4">
                    <h3 className="font-serif text-2xl text-spa-charcoal font-medium">{pkg.name}</h3>
                    <p className="text-xs text-spa-clay">{pkg.duration} mins total</p>
                  </div>

                  <p className="text-sm text-spa-clay/90 font-light leading-relaxed">{pkg.description}</p>

                  <ul className="space-y-2">
                    {pkg.benefits.map((benefit, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-xs text-spa-clay">
                        <Check className="w-3.5 h-3.5 text-spa-gold mt-0.5 flex-shrink-0" />
                        <span>{benefit}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="flex items-baseline gap-3 pt-2">
                    <span className="font-serif text-3xl font-semibold text-spa-gold-dark">{pkg.formattedPrice}</span>
                    <span className="text-sm text-spa-clay/60 line-through">{pkg.formattedOriginalPrice}</span>
                  </div>
                </div>

                <div className="p-8 pt-0">
                  <button
                    onClick={() => handleQuickBook(pkg)}
                    className={`w-full py-3.5 text-xs font-bold uppercase tracking-widest transition-all duration-300 rounded border ${
                      pkg.popular
                        ? 'bg-spa-gold hover:bg-spa-gold-dark text-spa-charcoal hover:text-white border-spa-gold'
                        : 'bg-spa-charcoal hover:bg-spa-gold text-spa-cream hover:text-spa-charcoal border-spa-charcoal/20'
                    }`}
                  >
                    Book This Package
                  </button>
                  <WhatsAppEnquiryLink name={`the ${pkg.name} package`} details={[`${pkg.duration} mins`, pkg.formattedPrice]} />
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
            <span className="text-spa-gold text-xs uppercase tracking-[0.3em] font-semibold block">Seamless Reservation</span>
            <h2 id={BOOKING_HEADING_ID} tabIndex={-1} className="font-serif text-3xl md:text-5xl text-spa-charcoal focus:outline-none">Schedule Your <span className="italic">Therapy</span></h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
            <p className="text-spa-clay text-sm font-light mt-4">
              Enter your preferences below to calculate prices transparently, select a therapist, and lock in your session slot.
            </p>
          </div>

          {/* Online booking: availability, reservation and payment through the booking system */}
          <BookingSection preselectServiceId={bookingPreselect} />
        </div>
      </section>

      {/* Tranquil Photo Gallery - Interactive Filterable Carousel */}
      <section id="gallery" className="py-24 bg-spa-linen border-t border-spa-taupe relative">
        <div className="max-w-7xl mx-auto px-6">
          
          {/* Section Header */}
          <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
            <span className="text-spa-gold text-xs uppercase tracking-[0.3em] font-semibold block">Tranquility Captured</span>
            <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal"><span className="italic">Sanctuary</span> Gallery</h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
            <p className="text-spa-clay text-sm font-light mt-4">
              A peaceful visual journey through our boutique treatment rooms, therapeutic hot stone arrangements, and organic aromatherapy rituals.
            </p>
          </div>

          {/* Gallery Filter Tabs */}
          <div className="flex justify-center items-center gap-2 sm:gap-4 mb-12 flex-wrap">
            {[
              { id: 'all', label: 'View All' },
              { id: 'sanctuary', label: 'Boutique Sanctuary' },
              { id: 'treatments', label: 'Therapies' },
              { id: 'therapy', label: 'Botanicals & Oils' }
            ].map((tab) => (
              <button 
                key={tab.id}
                onClick={() => setActiveGalleryFilter(tab.id as any)}
                className={`px-5 py-2 rounded-full text-xs uppercase tracking-widest font-bold transition-all border ${
                  activeGalleryFilter === tab.id 
                    ? 'bg-spa-charcoal border-spa-charcoal text-white shadow-md' 
                    : 'bg-white hover:bg-spa-linen border-spa-taupe text-spa-clay'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Gallery Grid */}
          <motion.div 
            layout 
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            <AnimatePresence mode="popLayout">
              {filteredGallery.map((item) => (
                <motion.div 
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.4 }}
                  key={item.id}
                  onClick={() => setActiveLightboxImage(item)}
                  className="group relative cursor-pointer overflow-hidden border border-spa-taupe bg-white p-2 rounded shadow-sm hover:shadow-2xl transition-all duration-300"
                >
                  <div className="relative h-64 sm:h-72 overflow-hidden rounded-sm">
                    <img 
                      src={item.imageUrl} 
                      alt={item.title} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 brightness-95"
                      referrerPolicy="no-referrer"
                    />
                    {/* Hover state content */}
                    <div className="absolute inset-0 bg-spa-charcoal/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                      <span className="text-white text-xs uppercase tracking-widest font-bold border border-white/50 px-4 py-2 rounded backdrop-blur-sm">
                        Expand Photo
                      </span>
                    </div>
                  </div>
                  <div className="pt-4 pb-2 px-1 flex justify-between items-center">
                    <span className="font-serif text-base text-spa-charcoal font-medium">{item.title}</span>
                    <span className="text-[10px] uppercase tracking-wider text-spa-gold font-bold capitalize">
                      {item.category}
                    </span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>

        </div>
      </section>

      {/* LIGHTBOX MODAL */}
      <AnimatePresence>
        {activeLightboxImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-spa-charcoal/95 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-8"
          >
            <button 
              onClick={() => setActiveLightboxImage(null)}
              className="absolute top-6 right-6 text-white hover:text-spa-gold transition-colors p-2 bg-white/5 rounded-full"
            >
              <X className="w-6 h-6" />
            </button>

            <motion.div 
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="max-w-4xl w-full flex flex-col gap-4 text-center"
            >
              <img 
                src={activeLightboxImage.imageUrl} 
                alt={activeLightboxImage.title} 
                className="max-h-[75vh] w-auto mx-auto object-contain rounded shadow-2xl border border-white/10"
                referrerPolicy="no-referrer"
              />
              <div className="space-y-1">
                <h3 className="font-serif text-2xl text-white font-medium">{activeLightboxImage.title}</h3>
                <p className="text-spa-gold text-xs uppercase tracking-widest font-bold capitalize">{activeLightboxImage.category}</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <VideoGalleryPreview />

      {/* Meet Our Therapists Section */}
      <section id="therapists" className="py-24 bg-spa-linen border-t border-spa-taupe relative">
        <div className="max-w-7xl mx-auto px-6">

          {/* Section Header */}
          <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
            <span className="text-spa-gold text-xs uppercase tracking-[0.3em] font-semibold block">The Hands Behind The Ritual</span>
            <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal">Meet Our <span className="italic">Therapists</span></h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
            <p className="text-spa-clay text-sm font-light mt-4">
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
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="pt-4 pb-2 px-1 text-center">
                  <span className="block font-serif text-base text-spa-charcoal font-medium">{member.name}</span>
                  <span className="block text-[10px] uppercase tracking-wider text-spa-gold font-bold mt-1">
                    {member.role}
                  </span>
                </div>
              </div>
            ))}
          </div>

        </div>
      </section>


      {/* Testimonials Grid / Guest Reviews */}
      <section className="py-24 bg-spa-linen border-t border-spa-taupe relative overflow-hidden">
        {/* Decorative blush accent, echoing the flyer's petals */}
        <div className="absolute -top-20 -left-20 w-80 h-80 bg-spa-blush/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
            <span className="text-spa-gold text-xs uppercase tracking-[0.3em] font-semibold block">Guest Experiences</span>
            <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal"><span className="italic">Tranquil</span> Feedback</h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {testimonialsData.map((test) => (
              <div 
                key={test.id}
                className="bg-white border border-spa-taupe p-8 rounded shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between"
              >
                <div className="space-y-4">
                  {/* Rating gold stars */}
                  <div className="flex gap-1">
                    {[...Array(test.rating)].map((_, i) => (
                      <span key={i} className="text-spa-gold font-bold">★</span>
                    ))}
                  </div>
                  <p className="text-sm text-spa-clay font-light leading-relaxed italic">
                    "{test.text}"
                  </p>
                </div>
                <div className="border-t border-spa-taupe/60 pt-4 mt-6 flex justify-between items-center text-xs">
                  <div>
                    <span className="font-bold text-spa-charcoal block">{test.name}</span>
                    <span className="text-spa-clay/70 font-light block">{test.location}</span>
                  </div>
                  <span className="text-[10px] bg-spa-linen border border-spa-taupe px-2.5 py-1 rounded-full text-spa-clay uppercase tracking-widest font-semibold">
                    {test.serviceName}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

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
                'Member-only pricing on Signature Packages',
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
            <span className="text-spa-gold text-xs uppercase tracking-[0.3em] font-semibold block">Clear Guidance</span>
            <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal">Frequently <span className="italic">Asked</span> Questions</h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
          </div>

          {/* Accordion Container */}
          <div className="space-y-4">
            {faqsData.map((faq) => (
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
                      <div className="p-6 text-sm text-spa-clay font-light leading-relaxed space-y-2">
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
                className="absolute top-4 right-4 text-spa-clay hover:text-spa-charcoal"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="space-y-4 mb-6">
                <h3 className="font-serif text-2xl text-spa-charcoal">Join the SMM Therapist Collective</h3>
                <p className="text-xs text-spa-clay leading-normal">
                  Are you a certified, highly professional massage therapist? Provide your contact details and specialty to join Nigeria's premium hybrid spa crew.
                </p>
              </div>

              {therapistApplicationSuccess ? (
                <div className="py-8 text-center space-y-3">
                  <CheckCircle2 className="w-12 h-12 text-spa-gold mx-auto animate-bounce" />
                  <h4 className="font-serif text-lg font-bold text-spa-charcoal">Application Submitted!</h4>
                  <p className="text-xs text-spa-clay">Our head clinical coordinator will reach out within 48 hours.</p>
                </div>
              ) : (
                <form onSubmit={handleTherapistSubmit} className="space-y-4 text-xs">
                  <div className="space-y-1">
                    <label className="block text-[10px] uppercase tracking-wider font-bold text-spa-charcoal">Full Name</label>
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
                      <label className="block text-[10px] uppercase tracking-wider font-bold text-spa-charcoal">Email Address</label>
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
                      <label className="block text-[10px] uppercase tracking-wider font-bold text-spa-charcoal">Phone Number</label>
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
                      <label className="block text-[10px] uppercase tracking-wider font-bold text-spa-charcoal">Primary Specialty</label>
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
                      <label className="block text-[10px] uppercase tracking-wider font-bold text-spa-charcoal">Years of Experience</label>
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
                    <label className="block text-[10px] uppercase tracking-wider font-bold text-spa-charcoal">Brief bio & background summary</label>
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
              <div className="pt-2 flex gap-4 text-spa-linen/80">
                <a href="https://facebook.com" className="hover:text-spa-gold transition-colors"><Facebook className="w-4 h-4" /></a>
                <a href="https://www.instagram.com/oges.vlog_spa/" target="_blank" rel="noopener noreferrer" className="hover:text-spa-gold transition-colors"><Instagram className="w-4 h-4" /></a>
                <a href="https://twitter.com" className="hover:text-spa-gold transition-colors"><Twitter className="w-4 h-4" /></a>
                <a href="https://t.me/sweet_mobile_massage" target="_blank" rel="noopener noreferrer" aria-label="Telegram" className="hover:text-spa-gold transition-colors"><Send className="w-4 h-4" /></a>
              </div>
            </div>

            {/* Column 2: Navigation Links */}
            <div className="md:col-span-2 space-y-4 text-xs">
              <h4 className="uppercase tracking-widest font-semibold text-spa-gold text-[10px]">Quick Navigation</h4>
              <ul className="space-y-2.5 font-light text-spa-linen/80">
                <li><a href="#" className="hover:text-spa-gold transition-colors">Home Base</a></li>
                <li><a href="#about" className="hover:text-spa-gold transition-colors">About the Spa</a></li>
                <li><a href="#services" className="hover:text-spa-gold transition-colors">Therapy Menu</a></li>
                <li><a href="#packages" className="hover:text-spa-gold transition-colors">Signature Packages</a></li>
                <li><a href="#gallery" className="hover:text-spa-gold transition-colors">Interactive Gallery</a></li>
                <li><a href="#booking" className="hover:text-spa-gold transition-colors">Secure a Slot</a></li>
              </ul>
            </div>

            {/* Column 3: Contact details */}
            <div className="md:col-span-3 space-y-4 text-xs">
              <h4 className="uppercase tracking-widest font-semibold text-spa-gold text-[10px]">Contact Info</h4>
              <ul className="space-y-2.5 font-light text-spa-linen/80">
                <li className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-spa-gold flex-shrink-0" />
                  <a href="mailto:ogebestie7@gmail.com" className="hover:text-spa-gold transition-colors">ogebestie7@gmail.com</a>
                </li>
                <li className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-spa-gold flex-shrink-0" />
                  <a href={`tel:${PHONE_E164}`} className="hover:text-spa-gold transition-colors">{PHONE_DISPLAY}</a>
                  <span className="text-spa-linen/40">/</span>
                  <a href="tel:+2347066672648" className="hover:text-spa-gold transition-colors">0706 672 648</a>
                </li>
                <li className="flex items-start gap-2 leading-relaxed">
                  <MapPin className="w-3.5 h-3.5 text-spa-gold flex-shrink-0 mt-0.5" />
                  <span>9B Oki Lane, Mende, Maryland, Lagos.</span>
                </li>
              </ul>
            </div>

            {/* Column 4: Apply to be therapist CTA */}
            <div className="md:col-span-3 space-y-4 text-xs">
              <h4 className="uppercase tracking-widest font-semibold text-spa-gold text-[10px]">Join Our Crew</h4>
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

          <div className="border-t border-white/5 mt-16 pt-8 text-center text-[10px] text-spa-linen/40 flex flex-col sm:flex-row justify-between items-center gap-4">
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
