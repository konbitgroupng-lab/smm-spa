import React, { useState, useEffect, useRef } from 'react';
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
  Play,
  Volume2,
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
import WhatsAppWidget from './components/WhatsAppWidget';
import SpaBookingWidget from './components/SpaBookingWidget';

interface VideoGalleryItem {
  id: string;
  title: string;
  category: 'services' | 'facility' | 'training';
  videoUrl: string;
  hasNarration?: boolean;
}

const videoGalleryData: VideoGalleryItem[] = [
  { id: 'teeth-whitening', title: 'Teeth Whitening Session', category: 'services', videoUrl: '/src/assets/videos/gallery/teeth-whitening.mp4' },
  { id: 'soft-wax', title: 'Soft Wax Treatment', category: 'services', videoUrl: '/src/assets/videos/gallery/soft-wax.mp4' },
  { id: 'thai-stone-massage', title: 'Thai Stone Massage', category: 'services', videoUrl: '/src/assets/videos/gallery/thai-stone-massage.mp4' },
  { id: 'full-body-detox', title: 'Full Body Detox', category: 'services', videoUrl: '/src/assets/videos/gallery/full-body-detox.mp4' },
  { id: 'spa-rooms', title: 'Spa Rooms & Facility Tour', category: 'facility', videoUrl: '/src/assets/videos/gallery/spa-rooms.mp4' },
  { id: 'lagos-walkthrough', title: 'Lagos Sanctuary Walkthrough', category: 'facility', videoUrl: '/src/assets/videos/gallery/lagos-walkthrough.mp4' },
  { id: 'operational-hours', title: 'We Are Open', category: 'facility', videoUrl: '/src/assets/videos/gallery/operational-hours.mp4' },
  { id: 'ceo-training-talk', title: 'CEO Training Talk', category: 'training', videoUrl: '/src/assets/videos/gallery/ceo-training-talk.mp4', hasNarration: true },
  { id: 'abuja-training-highlight', title: 'Abuja Training Highlight', category: 'training', videoUrl: '/src/assets/videos/gallery/abuja-training-highlight.mp4', hasNarration: true },
];

interface TeamMember {
  id: string;
  name: string;
  role: string;
  imageUrl: string;
}

const teamData: TeamMember[] = [
  { id: 'therapist-1', name: 'Senior Massage Therapist', role: 'Deep Tissue & Swedish Massage', imageUrl: '/src/assets/images/team/therapist-1.jpg' },
  { id: 'therapist-2', name: 'Lead Spa Therapist', role: 'Hot Stone & Aromatherapy', imageUrl: '/src/assets/images/team/therapist-2.jpg' },
  { id: 'therapist-3', name: 'Skincare & Facial Specialist', role: 'Facials, Waxing & Skin Treatments', imageUrl: '/src/assets/images/team/therapist-3.jpg' },
  { id: 'therapist-4', name: 'Wellness Therapist', role: 'Full Body Detox & Reflexology', imageUrl: '/src/assets/images/team/therapist-4.jpg' },
];

export default function App() {
  // Navigation & Scroll State
  const [isScrolled, setIsScrolled] = useState(false);
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

  // Booking Flow States
  const [bookings, setBookings] = useState<any[]>([]);
  const [selectedService, setSelectedService] = useState<Service>(servicesData[0]);
  const [bookingLocation, setBookingLocation] = useState<'sanctuary' | 'mobile'>('sanctuary');
  const [bookingArea, setBookingArea] = useState<string>('maryland');
  const [bookingAddress, setBookingAddress] = useState<string>('');
  const [bookingDate, setBookingDate] = useState<string>('');
  const [bookingTime, setBookingTime] = useState<string>('');
  const [selectedTherapist, setSelectedTherapist] = useState<Therapist | 'any'>('any');
  
  // Client Contact Details
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [specialNotes, setSpecialNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'card'>('bank_transfer');

  // Active Wizard Step
  const [bookingStep, setBookingStep] = useState<number>(1);
  const [bookingRefId, setBookingRefId] = useState<string | null>(null);
  const [bookingPass, setBookingPass] = useState<any | null>(null);

  // Gallery Filters & Lightbox
  const [activeGalleryFilter, setActiveGalleryFilter] = useState<'all' | 'sanctuary' | 'treatments' | 'therapy'>('all');
  const [activeLightboxImage, setActiveLightboxImage] = useState<GalleryItem | null>(null);

  // Video Gallery Filter & Modal Player
  const [activeVideoCategory, setActiveVideoCategory] = useState<'all' | 'services' | 'facility' | 'training'>('all');
  const [activeVideoModal, setActiveVideoModal] = useState<VideoGalleryItem | null>(null);
  const videoModalRef = useRef<HTMLVideoElement>(null);

  const closeVideoModal = () => {
    videoModalRef.current?.pause();
    setActiveVideoModal(null);
  };

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

  // Load Bookings from LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem('everest_bookings');
    if (saved) {
      try {
        setBookings(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  // Quick Notification Helper
  const showToast = (message: string) => {
    setNotification(message);
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // Pre-select service and scroll to booking form
  const handleQuickBook = (service: Service) => {
    setSelectedService(service);
    setBookingStep(1);
    
    // Calculate scroll target (Booking section)
    const element = document.getElementById('booking');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    showToast(`Selected ${service.name}. Let's secure your slot!`);
  };

  // Get dispatch fees based on selected location (relative to our Mende, Maryland home base)
  const getDispatchFee = () => {
    if (bookingLocation === 'sanctuary') return 0;
    switch (bookingArea) {
      case 'maryland': return 0;
      case 'mainland': return 3000;
      case 'airport': return 6000;
      case 'vi': return 8000;
      case 'lekki': return 10000;
      default: return 4000;
    }
  };

  const getAreaName = () => {
    switch (bookingArea) {
      case 'maryland': return 'Maryland / Mende / Ikeja Dispatch (Free)';
      case 'mainland': return 'Surulere / Yaba / Gbagada Dispatch (+₦3,000)';
      case 'airport': return 'Ajao Estate / Airport Road Dispatch (+₦6,000)';
      case 'vi': return 'Victoria Island Dispatch (+₦8,000)';
      case 'lekki': return 'Lekki Phase 1 / Ikoyi Dispatch (+₦10,000)';
      default: return 'Lagos Environs';
    }
  };

  // Final Price Calculation
  const getTotalPrice = () => {
    return selectedService.price + getDispatchFee();
  };

  // Time Slots Generator
  const timeSlots = [
    '09:00 AM',
    '11:00 AM',
    '01:00 PM',
    '03:00 PM',
    '05:00 PM',
    '07:00 PM'
  ];

  // Elegant Custom Calendar Dates (Next 14 Days)
  const getAvailableDates = () => {
    const dates = [];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    for (let i = 1; i <= 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      dates.push({
        dayName: days[d.getDay()],
        dayNum: d.getDate(),
        month: months[d.getMonth()],
        iso: d.toISOString().split('T')[0]
      });
    }
    return dates;
  };

  // Booking submit handler
  const handleCompleteBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName || !clientEmail || !clientPhone) {
      showToast('Please fill in all contact details.');
      return;
    }
    if (bookingLocation === 'mobile' && !bookingAddress) {
      showToast('Please provide your dispatch address.');
      return;
    }

    const refId = `EV-${Math.floor(1000 + Math.random() * 9000)}-${bookingDate.substring(8,10)}${bookingTime.substring(0,2)}`;
    
    const newBooking = {
      id: refId,
      service: selectedService,
      location: bookingLocation,
      address: bookingLocation === 'mobile' ? `${bookingAddress}, ${getAreaName()}` : 'Boutique Sanctuary, 9B Oki Lane, Mende, Maryland, Lagos',
      date: bookingDate,
      time: bookingTime,
      therapist: selectedTherapist === 'any' ? { name: 'Any Available Specialist' } : selectedTherapist,
      client: {
        name: clientName,
        email: clientEmail,
        phone: clientPhone,
        notes: specialNotes
      },
      payment: paymentMethod,
      total: getTotalPrice(),
      status: 'pending_payment_verification',
      createdAt: new Date().toISOString()
    };

    const updatedBookings = [newBooking, ...bookings];
    setBookings(updatedBookings);
    localStorage.setItem('everest_bookings', JSON.stringify(updatedBookings));

    setBookingRefId(refId);
    setBookingPass(newBooking);
    setBookingStep(5); // Show pass step
    showToast('Your serene therapy has been tentatively scheduled!');
  };

  // Cancel Booking Helper
  const handleCancelBooking = (id: string) => {
    if (window.confirm('Are you sure you need to cancel this appointment? SMM (Sweet Mobile Massage and Spa) adheres to a flexible rescheduling policy, but last minute cancellations may trigger fees.')) {
      const updated = bookings.filter(b => b.id !== id);
      setBookings(updated);
      localStorage.setItem('everest_bookings', JSON.stringify(updated));
      showToast('Appointment successfully cancelled.');
    }
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

  // Filter video gallery items
  const filteredVideoGallery = activeVideoCategory === 'all'
    ? videoGalleryData
    : videoGalleryData.filter(item => item.category === activeVideoCategory);

  // Filter service items by tab
  const filteredServices = activeSection === 'all'
    ? servicesData
    : servicesData.filter(s => s.category.toLowerCase().includes(activeSection.slice(0, 4)));

  return (
    <div className="relative min-h-screen selection:bg-spa-gold selection:text-white">

      {/* Floating viewport-anchored widgets - visible immediately, not scroll-dependent */}
      <WhatsAppWidget />
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
        className={`fixed top-0 left-0 w-full z-40 transition-all duration-500 ${
          isScrolled 
            ? 'bg-spa-charcoal/95 backdrop-blur-md border-b border-spa-charcoal/20 py-4 shadow-lg'
            : 'bg-gradient-to-b from-spa-berry/50 to-transparent py-6'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <a href="#" className="flex items-center group flex-shrink-0">
            <img
              src="/src/assets/images/smm_logo_cropped.png"
              alt="SMM (Sweet Mobile Massage and Spa)"
              className="h-[70px] sm:h-20 lg:h-[88px] w-auto object-contain flex-shrink-0"
            />
          </a>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-4 lg:gap-8 xl:gap-12 whitespace-nowrap">
            <a href="#about" className="text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold transition-colors duration-200">About Us</a>
            <a href="#services" className="text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold transition-colors duration-200">Services</a>
            <a href="#packages" className="text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold transition-colors duration-200">Packages</a>
            <a href="#gallery" className="text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold transition-colors duration-200">Gallery</a>
            <a href="#video-gallery" className="text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold transition-colors duration-200">Video Gallery</a>
            <a href="#therapists" className="text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold transition-colors duration-200">Our Therapists</a>
            <a href="#booking" className="text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold transition-colors duration-200 font-medium">Book Online</a>
            <a href="#faqs" className="text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold transition-colors duration-200">FAQs</a>
          </nav>

          <div className="flex items-center gap-4">
            {bookings.length > 0 && (
              <a 
                href="#my-bookings" 
                className="hidden lg:flex items-center gap-1.5 text-xs uppercase tracking-wider bg-white/10 hover:bg-white/20 text-spa-cream px-3 py-1.5 rounded-full border border-white/20 transition-all"
              >
                <CalendarCheck className="w-3.5 h-3.5 text-spa-gold" />
                <span>My Bookings ({bookings.length})</span>
              </a>
            )}
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
      <section className="relative h-[95vh] w-full flex items-center justify-center overflow-hidden bg-spa-charcoal">

        {/* Slide 1: Full-bleed sanctuary photo with the primary hero copy */}
        <div
          aria-hidden={heroSlide !== 0}
          className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
            heroSlide === 0 ? 'opacity-100 z-[1]' : 'opacity-0 z-0 pointer-events-none'
          }`}
        >
          <img
            src="/src/assets/images/spa_hero_banner_1783345955168.jpg"
            alt="SMM (Sweet Mobile Massage and Spa) Treatment Sanctuary"
            className="absolute inset-0 w-full h-full object-cover scale-105 select-none brightness-[0.80] contrast-[1.05]"
            referrerPolicy="no-referrer"
          />
          {/* Brand gradient wash - darkening scrim for text contrast + the flyer's signature terracotta-to-berry tint */}
          <div className="absolute inset-0 bg-black/30"></div>
          <div className="absolute inset-0 brand-gradient opacity-75"></div>
          <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-spa-cream to-transparent"></div>

          <div className="relative z-10 h-full flex items-center justify-center">
            <div className="max-w-5xl mx-auto px-6 text-center text-spa-cream pt-12">
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1.2, ease: "easeOut" }}
                className="space-y-6"
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

                <div className="pt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
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
            src="/src/assets/images/smm_promo_tension_to_tranquility.webp"
            alt="SMM Sweet Mobile Massage and Spa promotional campaign: From Tension to Tranquility"
            className="absolute inset-0 w-full h-full object-cover object-[center_65%] select-none"
            referrerPolicy="no-referrer"
          />

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
            src="/src/assets/images/hero-slide-2.jpg"
            alt="SMM Sweet Mobile Massage and Spa promotional campaign: Relax Your Body, Calm Your Mind, Renew Your Spirit"
            className="absolute inset-0 w-full h-full object-cover object-[52%_58%] sm:object-[center_62%] select-none"
            referrerPolicy="no-referrer"
          />

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
                  <source src="/src/assets/videos/walk-in-spa.mp4" type="video/mp4" />
                </video>
              </div>
              <div className="absolute -bottom-8 -right-8 w-1/2 hidden md:block border border-spa-taupe p-2 bg-white shadow-2xl rounded-sm z-20">
                <img
                  src="/src/assets/images/front-desk-sign.jpg"
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
            {servicesData.map((service) => (
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
            {packagesData.map((pkg) => (
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
            <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal">Schedule Your <span className="italic">Therapy</span></h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
            <p className="text-spa-clay text-sm font-light mt-4">
              Enter your preferences below to calculate prices transparently, select a therapist, and lock in your session slot.
            </p>
          </div>

          {/* Booking Container */}
          <div className="bg-white border border-spa-taupe rounded shadow-2xl overflow-hidden">
            
            {/* Wizard Navigation Progress */}
            <div className="bg-spa-charcoal text-white px-6 py-4 flex flex-wrap items-center justify-between border-b border-white/10 gap-3">
              <div className="flex items-center gap-2">
                <span className="font-serif text-lg text-spa-gold">Booking Cart</span>
                <span className="text-xs text-white/50">| Step {bookingStep === 5 ? 'Confirmed' : `${bookingStep} of 4`}</span>
              </div>
              {bookingStep < 5 && (
                <div className="text-xs uppercase tracking-widest text-spa-gold font-bold">
                  Total Estimated: ₦{getTotalPrice().toLocaleString()}
                </div>
              )}
            </div>

            {/* Wizard Steps indicator bar */}
            {bookingStep < 5 && (
              <div className="grid grid-cols-4 bg-spa-linen border-b border-spa-taupe text-center">
                {[
                  { step: 1, label: 'Therapy & Venue' },
                  { step: 2, label: 'Date & Time' },
                  { step: 3, label: 'Therapist' },
                  { step: 4, label: 'Contact' }
                ].map((item) => (
                  <button 
                    key={item.step}
                    onClick={() => {
                      if (item.step < bookingStep) setBookingStep(item.step);
                    }}
                    disabled={item.step >= bookingStep}
                    className={`py-3 text-[10px] sm:text-xs uppercase tracking-wider border-r border-spa-taupe last:border-r-0 transition-all ${
                      bookingStep === item.step 
                        ? 'bg-white font-bold text-spa-gold border-b-2 border-b-spa-gold' 
                        : item.step < bookingStep 
                          ? 'text-spa-charcoal hover:bg-white/50' 
                          : 'text-spa-clay/40'
                    }`}
                  >
                    <span className="hidden sm:inline">{item.step}. </span>{item.label}
                  </button>
                ))}
              </div>
            )}

            {/* Wizard Form Steps */}
            <div className="p-8">
              <form onSubmit={handleCompleteBooking}>
                
                {/* STEP 1: Service & Location Selector */}
                {bookingStep === 1 && (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="space-y-8"
                  >
                    {/* Service select list */}
                    <div className="space-y-3">
                      <label className="block text-xs uppercase tracking-widest text-spa-charcoal font-bold">Select Therapy Style</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {servicesData.map((service) => (
                          <div 
                            key={service.id}
                            onClick={() => setSelectedService(service)}
                            className={`p-4 border rounded cursor-pointer transition-all flex justify-between items-center ${
                              selectedService.id === service.id 
                                ? 'border-spa-gold bg-spa-cream/50 shadow-md' 
                                : 'border-spa-taupe hover:border-spa-gold/60'
                            }`}
                          >
                            <div className="space-y-1">
                              <span className="font-serif text-base font-semibold block text-spa-charcoal">{service.name}</span>
                              <span className="text-xs text-spa-clay">{service.duration} mins • {service.category}</span>
                            </div>
                            <span className="font-serif text-sm font-semibold text-spa-gold-dark">{service.formattedPrice}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Venue select */}
                    <div className="space-y-4">
                      <label className="block text-xs uppercase tracking-widest text-spa-charcoal font-bold">Preferred Venue</label>
                      <div className="grid grid-cols-2 gap-4">
                        <div 
                          onClick={() => setBookingLocation('sanctuary')}
                          className={`p-5 border rounded cursor-pointer transition-all space-y-2 text-center ${
                            bookingLocation === 'sanctuary' 
                              ? 'border-spa-gold bg-spa-cream/50 shadow-md' 
                              : 'border-spa-taupe hover:border-spa-gold/60'
                          }`}
                        >
                          <Home className="w-5 h-5 mx-auto text-spa-gold" />
                          <h4 className="font-serif text-sm font-bold text-spa-charcoal">Boutique Sanctuary</h4>
                          <p className="text-[10px] text-spa-clay leading-tight">Relax in our highly hygienic, gated facility in Mende, Maryland (Free Entrance)</p>
                        </div>

                        <div 
                          onClick={() => setBookingLocation('mobile')}
                          className={`p-5 border rounded cursor-pointer transition-all space-y-2 text-center ${
                            bookingLocation === 'mobile' 
                              ? 'border-spa-gold bg-spa-cream/50 shadow-md' 
                              : 'border-spa-taupe hover:border-spa-gold/60'
                          }`}
                        >
                          <MapPin className="w-5 h-5 mx-auto text-spa-gold" />
                          <h4 className="font-serif text-sm font-bold text-spa-charcoal">Mobile In-Home Spa</h4>
                          <p className="text-[10px] text-spa-clay leading-tight">Delivered directly to your residence, hotel, or office in Lagos</p>
                        </div>
                      </div>
                    </div>

                    {/* Conditional Mobile Fields */}
                    {bookingLocation === 'mobile' && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="space-y-4 pt-4 border-t border-spa-taupe"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="block text-xs uppercase tracking-widest text-spa-charcoal font-bold">Select Dispatch Zone</label>
                            <select 
                              value={bookingArea}
                              onChange={(e) => setBookingArea(e.target.value)}
                              className="w-full bg-white border border-spa-taupe text-spa-charcoal text-sm p-3 focus:outline-none focus:border-spa-gold rounded"
                            >
                              <option value="maryland">Maryland, Mende, Ikeja (Free)</option>
                              <option value="mainland">Surulere, Yaba, Gbagada (+₦3,000)</option>
                              <option value="airport">Ajao Estate, Airport Road (+₦6,000)</option>
                              <option value="vi">Victoria Island (+₦8,000)</option>
                              <option value="lekki">Lekki Phase 1, Ikoyi (+₦10,000)</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label className="block text-xs uppercase tracking-widest text-spa-charcoal font-bold">In-Home / Hotel Street Address</label>
                            <input 
                              type="text" 
                              required={bookingLocation === 'mobile'}
                              placeholder="e.g. Penthouse 4, Block C, Lekki Gardens"
                              value={bookingAddress}
                              onChange={(e) => setBookingAddress(e.target.value)}
                              className="w-full bg-white border border-spa-taupe text-spa-charcoal text-sm p-3 focus:outline-none focus:border-spa-gold rounded"
                            />
                          </div>
                        </div>
                        <div className="text-[11px] text-spa-clay italic bg-spa-linen p-3 rounded border border-spa-taupe/50">
                          * Note: Our mobile therapists transport full massage tables, specialized oil sets, custom music equipment, and pristine linens. Please ensure your building elevator is operational, or direct our coordinator on unloading.
                        </div>
                      </motion.div>
                    )}

                    {/* Step Action Button */}
                    <div className="pt-4 flex justify-end">
                      <button 
                        type="button"
                        onClick={() => setBookingStep(2)}
                        className="bg-spa-charcoal hover:bg-spa-gold text-spa-cream hover:text-spa-charcoal font-bold uppercase tracking-widest text-xs px-6 py-3.5 transition-all rounded flex items-center gap-2"
                      >
                        <span>Next: Date & Time</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* STEP 2: Custom Date & Time Grid */}
                {bookingStep === 2 && (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="space-y-8"
                  >
                    {/* Date select slider */}
                    <div className="space-y-3">
                      <label className="block text-xs uppercase tracking-widest text-spa-charcoal font-bold">1. Select Booking Date</label>
                      <div className="flex gap-3 overflow-x-auto pb-4 pt-1 snap-x scrollbar-thin">
                        {getAvailableDates().map((item) => (
                          <div 
                            key={item.iso}
                            onClick={() => setBookingDate(item.iso)}
                            className={`flex-shrink-0 w-20 py-4 border rounded cursor-pointer transition-all text-center snap-start ${
                              bookingDate === item.iso 
                                ? 'border-spa-gold bg-spa-charcoal text-white shadow-lg scale-105' 
                                : 'border-spa-taupe bg-white hover:border-spa-gold/60 text-spa-charcoal'
                            }`}
                          >
                            <span className="text-[10px] uppercase tracking-wider block opacity-70">{item.dayName}</span>
                            <span className="font-serif text-2xl font-bold block my-1">{item.dayNum}</span>
                            <span className="text-[10px] uppercase tracking-wider block font-medium text-spa-gold">{item.month}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Time slot picker */}
                    <div className="space-y-3">
                      <label className="block text-xs uppercase tracking-widest text-spa-charcoal font-bold">2. Select Preferred Time Slot</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {timeSlots.map((slot) => (
                          <div 
                            key={slot}
                            onClick={() => setBookingTime(slot)}
                            className={`py-3.5 border rounded cursor-pointer transition-all text-center text-sm font-semibold flex items-center justify-center gap-2 ${
                              bookingTime === slot 
                                ? 'border-spa-gold bg-spa-cream/50 shadow-md text-spa-gold-dark' 
                                : 'border-spa-taupe bg-white hover:border-spa-gold/60 text-spa-charcoal'
                            }`}
                          >
                            <Clock className="w-4 h-4 opacity-60" />
                            <span>{slot}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Navigation buttons */}
                    <div className="pt-4 flex justify-between">
                      <button 
                        type="button"
                        onClick={() => setBookingStep(1)}
                        className="border border-spa-taupe text-spa-charcoal hover:bg-spa-linen font-bold uppercase tracking-widest text-xs px-6 py-3.5 transition-all rounded flex items-center gap-2"
                      >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Back</span>
                      </button>
                      <button 
                        type="button"
                        onClick={() => {
                          if (!bookingDate || !bookingTime) {
                            showToast('Please select both a date and a time slot.');
                            return;
                          }
                          setBookingStep(3);
                        }}
                        className="bg-spa-charcoal hover:bg-spa-gold text-spa-cream hover:text-spa-charcoal font-bold uppercase tracking-widest text-xs px-6 py-3.5 transition-all rounded flex items-center gap-2"
                      >
                        <span>Next: Therapist</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* STEP 3: Therapist Selection */}
                {bookingStep === 3 && (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="space-y-8"
                  >
                    <div className="space-y-4">
                      <label className="block text-xs uppercase tracking-widest text-spa-charcoal font-bold">Select Therapist Specialist</label>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Option: Any available */}
                        <div 
                          onClick={() => setSelectedTherapist('any')}
                          className={`p-6 border rounded cursor-pointer transition-all flex items-center gap-4 ${
                            selectedTherapist === 'any' 
                              ? 'border-spa-gold bg-spa-cream/50 shadow-md' 
                              : 'border-spa-taupe hover:border-spa-gold/60'
                          }`}
                        >
                          <div className="w-14 h-14 rounded-full bg-spa-linen border border-spa-taupe flex items-center justify-center text-spa-gold">
                            <User className="w-6 h-6" />
                          </div>
                          <div>
                            <h4 className="font-serif text-base font-bold text-spa-charcoal">Any Available Specialist</h4>
                            <p className="text-xs text-spa-clay/90">Highly recommended for immediate slot reservation.</p>
                          </div>
                        </div>

                        {/* Explicit Therapist List */}
                        {therapistsData.map((therapist) => (
                          <div 
                            key={therapist.id}
                            onClick={() => setSelectedTherapist(therapist)}
                            className={`p-6 border rounded cursor-pointer transition-all flex items-start gap-4 ${
                              selectedTherapist !== 'any' && selectedTherapist.id === therapist.id 
                                ? 'border-spa-gold bg-spa-cream/50 shadow-md' 
                                : 'border-spa-taupe hover:border-spa-gold/60'
                            }`}
                          >
                            <img 
                              src={therapist.avatarUrl} 
                              alt={therapist.name} 
                              className="w-14 h-14 rounded-full object-cover border border-spa-taupe flex-shrink-0"
                              referrerPolicy="no-referrer"
                            />
                            <div className="space-y-1">
                              <h4 className="font-serif text-base font-bold text-spa-charcoal">{therapist.name}</h4>
                              <p className="text-[11px] font-semibold text-spa-gold uppercase tracking-wider">{therapist.role}</p>
                              <p className="text-xs text-spa-clay leading-tight line-clamp-2">{therapist.bio}</p>
                              <span className="inline-block text-[10px] bg-spa-linen border border-spa-taupe text-spa-clay px-2 py-0.5 rounded-full mt-1.5 font-medium">
                                Specialty: {therapist.specialty}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Navigation buttons */}
                    <div className="pt-4 flex justify-between">
                      <button 
                        type="button"
                        onClick={() => setBookingStep(2)}
                        className="border border-spa-taupe text-spa-charcoal hover:bg-spa-linen font-bold uppercase tracking-widest text-xs px-6 py-3.5 transition-all rounded flex items-center gap-2"
                      >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Back</span>
                      </button>
                      <button 
                        type="button"
                        onClick={() => setBookingStep(4)}
                        className="bg-spa-charcoal hover:bg-spa-gold text-spa-cream hover:text-spa-charcoal font-bold uppercase tracking-widest text-xs px-6 py-3.5 transition-all rounded flex items-center gap-2"
                      >
                        <span>Next: Contact Details</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* STEP 4: Client Info & Final Breakdown */}
                {bookingStep === 4 && (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="space-y-8"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {/* Client inputs column */}
                      <div className="space-y-4">
                        <h4 className="font-serif text-lg font-bold border-b border-spa-taupe pb-2 text-spa-charcoal">Your Information</h4>
                        
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase tracking-widest font-bold text-spa-charcoal block">Full Name</label>
                          <div className="relative">
                            <span className="absolute left-3 top-3 text-spa-clay"><User className="w-4 h-4" /></span>
                            <input 
                              type="text" 
                              required 
                              placeholder="e.g. Amina Alao"
                              value={clientName}
                              onChange={(e) => setClientName(e.target.value)}
                              className="w-full bg-spa-cream/30 border border-spa-taupe text-spa-charcoal text-sm p-3 pl-10 focus:outline-none focus:border-spa-gold rounded"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase tracking-widest font-bold text-spa-charcoal block">Email Address</label>
                            <div className="relative">
                              <span className="absolute left-3 top-3 text-spa-clay"><Mail className="w-4 h-4" /></span>
                              <input 
                                type="email" 
                                required 
                                placeholder="name@domain.com"
                                value={clientEmail}
                                onChange={(e) => setClientEmail(e.target.value)}
                                className="w-full bg-spa-cream/30 border border-spa-taupe text-spa-charcoal text-sm p-3 pl-10 focus:outline-none focus:border-spa-gold rounded"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] uppercase tracking-widest font-bold text-spa-charcoal block">Phone Number</label>
                            <div className="relative">
                              <span className="absolute left-3 top-3 text-spa-clay"><Phone className="w-4 h-4" /></span>
                              <input 
                                type="tel" 
                                required 
                                placeholder="+234..."
                                value={clientPhone}
                                onChange={(e) => setClientPhone(e.target.value)}
                                className="w-full bg-spa-cream/30 border border-spa-taupe text-spa-charcoal text-sm p-3 pl-10 focus:outline-none focus:border-spa-gold rounded"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] uppercase tracking-widest font-bold text-spa-charcoal block">Special requests / Medical Notes (Optional)</label>
                          <textarea 
                            rows={3}
                            placeholder="e.g. Focus on lower-back knots, light shoulder pressure, lavender allergy, etc."
                            value={specialNotes}
                            onChange={(e) => setSpecialNotes(e.target.value)}
                            className="w-full bg-spa-cream/30 border border-spa-taupe text-spa-charcoal text-sm p-3 focus:outline-none focus:border-spa-gold rounded resize-none"
                          />
                        </div>

                        {/* Payment Preferences */}
                        <div className="space-y-2 pt-2">
                          <label className="text-[10px] uppercase tracking-widest font-bold text-spa-charcoal block">Payment Method Selector</label>
                          <div className="grid grid-cols-2 gap-3">
                            <div 
                              onClick={() => setPaymentMethod('bank_transfer')}
                              className={`p-3 border rounded text-center cursor-pointer transition-all text-xs font-semibold ${
                                paymentMethod === 'bank_transfer' ? 'border-spa-gold bg-spa-linen' : 'border-spa-taupe'
                              }`}
                            >
                              Instant Bank Transfer
                            </div>
                            <div 
                              onClick={() => setPaymentMethod('card')}
                              className={`p-3 border rounded text-center cursor-pointer transition-all text-xs font-semibold ${
                                paymentMethod === 'card' ? 'border-spa-gold bg-spa-linen' : 'border-spa-taupe'
                              }`}
                            >
                              Secure Card Payment
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Summary & Price breakdown column */}
                      <div className="space-y-6 bg-spa-linen/50 border border-spa-taupe p-6 rounded">
                        <h4 className="font-serif text-lg font-bold border-b border-spa-taupe pb-2 text-spa-charcoal">Appointment Pass Details</h4>
                        
                        <div className="space-y-3 text-sm">
                          <div className="flex justify-between">
                            <span className="text-spa-clay font-light">Therapy Style:</span>
                            <span className="font-bold text-spa-charcoal">{selectedService.name} ({selectedService.duration} mins)</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-spa-clay font-light">Selected Venue:</span>
                            <span className="font-bold text-spa-charcoal capitalize">{bookingLocation === 'sanctuary' ? 'Boutique Sanctuary' : 'Mobile In-Home'}</span>
                          </div>
                          {bookingLocation === 'mobile' && (
                            <div className="flex justify-between">
                              <span className="text-spa-clay font-light">Location Address:</span>
                              <span className="font-bold text-spa-charcoal text-right text-xs max-w-[200px] truncate">{bookingAddress}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-spa-clay font-light">Scheduled Date:</span>
                            <span className="font-bold text-spa-charcoal">{bookingDate}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-spa-clay font-light">Scheduled Time:</span>
                            <span className="font-bold text-spa-charcoal">{bookingTime}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-spa-clay font-light">Assigned Therapist:</span>
                            <span className="font-bold text-spa-gold-dark">{selectedTherapist === 'any' ? 'First Available Specialist' : selectedTherapist.name}</span>
                          </div>
                        </div>

                        {/* Price Breakdown */}
                        <div className="border-t border-spa-taupe pt-4 space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-spa-clay">Base Service Fee:</span>
                            <span className="font-bold">₦{selectedService.price.toLocaleString()}</span>
                          </div>
                          {bookingLocation === 'mobile' && (
                            <div className="flex justify-between text-sm">
                              <span className="text-spa-clay">Travel Dispatch:</span>
                              <span className="font-bold">₦{getDispatchFee().toLocaleString()}</span>
                            </div>
                          )}
                          <div className="flex justify-between text-base border-t border-spa-taupe pt-3 font-serif">
                            <span className="font-bold text-spa-charcoal">Total Amount Due:</span>
                            <span className="font-bold text-spa-gold-dark text-xl">₦{getTotalPrice().toLocaleString()}</span>
                          </div>
                        </div>

                        <div className="text-[10px] text-spa-clay/80 leading-normal border-t border-spa-taupe/50 pt-3">
                          * By confirming, you acknowledge that SMM (Sweet Mobile Massage and Spa) requires bank transfer verification or card validation to locked the slot permanently. Services must be utilized within 30 days of booking.
                        </div>
                      </div>
                    </div>

                    {/* Navigation buttons */}
                    <div className="pt-4 flex justify-between">
                      <button 
                        type="button"
                        onClick={() => setBookingStep(3)}
                        className="border border-spa-taupe text-spa-charcoal hover:bg-spa-linen font-bold uppercase tracking-widest text-xs px-6 py-3.5 transition-all rounded flex items-center gap-2"
                      >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Back</span>
                      </button>
                      <button 
                        type="submit"
                        className="bg-spa-gold hover:bg-spa-gold-dark text-spa-charcoal hover:text-white font-bold uppercase tracking-widest text-xs px-8 py-4 transition-all rounded flex items-center gap-2 shadow-lg"
                      >
                        <span>Confirm & Generate Booking Pass</span>
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* STEP 5: Beautiful generated ticket pass */}
                {bookingStep === 5 && bookingPass && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-8 py-4"
                  >
                    <div className="text-center space-y-2">
                      <CheckCircle2 className="w-12 h-12 text-spa-gold mx-auto animate-bounce" />
                      <h3 className="font-serif text-2xl md:text-3xl text-spa-charcoal">Sanctuary Reservation Pending</h3>
                      <p className="text-xs text-spa-clay tracking-wide max-w-md mx-auto">
                        We have tentatively locked your time slot. To validate and complete payment, please review your passport ticket below.
                      </p>
                    </div>

                    {/* TICKET PASS WRAPPER */}
                    <div className="max-w-md mx-auto border-2 border-dashed border-spa-gold bg-spa-cream/30 p-6 rounded-lg relative overflow-hidden shadow-xl">
                      {/* Ticket header details */}
                      <div className="border-b-2 border-spa-taupe pb-4 flex justify-between items-start">
                        <div>
                          <span className="text-[10px] text-spa-gold uppercase tracking-[0.2em] block font-bold">SMM Wellness Ticket</span>
                          <span className="font-serif text-xs font-semibold text-spa-charcoal block mt-1">Ref ID: {bookingPass.id}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[9px] bg-spa-linen border border-spa-taupe px-2 py-0.5 rounded-full font-bold text-spa-gold">
                            Verification Pending
                          </span>
                        </div>
                      </div>

                      {/* Ticket body details */}
                      <div className="py-6 space-y-4 text-xs">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-[10px] text-spa-clay uppercase tracking-wider block font-light">Client:</span>
                            <span className="font-bold text-spa-charcoal text-sm">{bookingPass.client.name}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-spa-clay uppercase tracking-wider block font-light">Therapy Style:</span>
                            <span className="font-bold text-spa-charcoal text-sm">{bookingPass.service.name}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-[10px] text-spa-clay uppercase tracking-wider block font-light">Date:</span>
                            <span className="font-bold text-spa-charcoal">{bookingPass.date}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-spa-clay uppercase tracking-wider block font-light">Time:</span>
                            <span className="font-bold text-spa-charcoal">{bookingPass.time}</span>
                          </div>
                        </div>

                        <div>
                          <span className="text-[10px] text-spa-clay uppercase tracking-wider block font-light">Venue / address:</span>
                          <span className="font-medium text-spa-charcoal">{bookingPass.address}</span>
                        </div>

                        <div className="grid grid-cols-2 gap-4 border-t border-spa-taupe/50 pt-3">
                          <div>
                            <span className="text-[10px] text-spa-clay uppercase tracking-wider block font-light">Assigned Expert:</span>
                            <span className="font-bold text-spa-gold">{bookingPass.therapist.name}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-spa-clay uppercase tracking-wider block font-light">Total Due:</span>
                            <span className="font-serif text-sm font-bold text-spa-gold-dark">₦{bookingPass.total.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>

                      {/* Bank transfer payment instructions */}
                      <div className="bg-white border border-spa-taupe p-4 rounded text-xs space-y-2.5">
                        <span className="font-bold text-spa-charcoal block border-b border-spa-taupe pb-1">Payment Instructions</span>
                        <p className="text-[11px] text-spa-clay leading-relaxed">
                          Please perform a bank transfer of <strong>₦{bookingPass.total.toLocaleString()}</strong> to our secure account:
                        </p>
                        <div className="bg-spa-cream p-2.5 rounded font-mono text-[11px] border border-spa-taupe/40 space-y-1">
                          <p><span className="text-spa-clay">Bank:</span> Standard Chartered Bank</p>
                          <p><span className="text-spa-clay">Account No:</span> 0013819712</p>
                          <p><span className="text-spa-clay">Name:</span> Sweet Mobile Massage and Spa Limited</p>
                        </div>
                        <p className="text-[10px] text-spa-clay leading-normal italic">
                          * Reference your ID <strong>{bookingPass.id}</strong> in your transfer. Send proof of payment via WhatsApp (+234 811 859 9365) or email to immediately activate verification.
                        </p>
                      </div>
                    </div>

                    {/* Actions block */}
                    <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                      <button 
                        type="button"
                        onClick={() => window.print()}
                        className="w-full sm:w-auto border border-spa-taupe hover:bg-spa-linen text-spa-charcoal px-5 py-3 text-xs uppercase tracking-widest font-bold transition-all rounded flex items-center justify-center gap-2"
                      >
                        <Printer className="w-4 h-4" />
                        <span>Print Ticket</span>
                      </button>
                      <button 
                        type="button"
                        onClick={() => {
                          setBookingStep(1);
                          setBookingRefId(null);
                          setBookingPass(null);
                        }}
                        className="w-full sm:w-auto bg-spa-charcoal hover:bg-spa-gold text-spa-cream hover:text-spa-charcoal px-6 py-3 text-xs uppercase tracking-widest font-bold transition-all rounded flex items-center justify-center gap-2"
                      >
                        <span>Schedule Another Slot</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )}

              </form>
            </div>

          </div>
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

      {/* Video Gallery Section - Our Services in Action, Facility, and Team & Training clips */}
      <section id="video-gallery" className="py-24 bg-spa-cream border-t border-spa-taupe relative">
        <div className="max-w-7xl mx-auto px-6">

          {/* Section Header */}
          <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
            <span className="text-spa-gold text-xs uppercase tracking-[0.3em] font-semibold block">See It In Motion</span>
            <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal">Video <span className="italic">Gallery</span></h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
            <p className="text-spa-clay text-sm font-light mt-4">
              Real sessions, our boutique sanctuary, and the team behind SMM (Sweet Mobile Massage and Spa) &mdash; captured on video.
            </p>
          </div>

          {/* Video Category Filter Tabs */}
          <div className="flex justify-center items-center gap-2 sm:gap-4 mb-12 flex-wrap">
            {[
              { id: 'all', label: 'View All' },
              { id: 'services', label: 'Services' },
              { id: 'facility', label: 'Facility' },
              { id: 'training', label: 'Team & Training' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveVideoCategory(tab.id as any)}
                className={`px-5 py-2 rounded-full text-xs uppercase tracking-widest font-bold transition-all border ${
                  activeVideoCategory === tab.id
                    ? 'bg-spa-charcoal border-spa-charcoal text-white shadow-md'
                    : 'bg-white hover:bg-spa-linen border-spa-taupe text-spa-clay'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Video Grid */}
          <motion.div
            layout
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            <AnimatePresence mode="popLayout">
              {filteredVideoGallery.map((item) => (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.4 }}
                  key={item.id}
                  onClick={() => setActiveVideoModal(item)}
                  className="group relative cursor-pointer overflow-hidden border border-spa-taupe bg-white p-2 rounded shadow-sm hover:shadow-2xl transition-all duration-300"
                >
                  <div className="relative aspect-[4/5] overflow-hidden rounded-sm bg-spa-charcoal">
                    <video
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="w-full h-full object-cover brightness-95"
                    >
                      <source src={item.videoUrl} type="video/mp4" />
                    </video>

                    {/* Hover state content */}
                    <div className="absolute inset-0 bg-spa-charcoal/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                      <span className="text-white text-xs uppercase tracking-widest font-bold border border-white/50 px-4 py-2 rounded backdrop-blur-sm">
                        {item.hasNarration ? 'Play With Sound' : 'Play Video'}
                      </span>
                    </div>

                    {item.hasNarration && (
                      <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-spa-gold text-spa-charcoal text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shadow-sm pointer-events-none">
                        <Volume2 className="w-3 h-3" />
                        <span>Sound On</span>
                      </div>
                    )}

                    <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-spa-charcoal/50 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                      <Play className="w-3.5 h-3.5 text-white fill-white" />
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

      {/* VIDEO MODAL PLAYER - full controls, unmuted, closes cleanly and stops audio */}
      <AnimatePresence>
        {activeVideoModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeVideoModal}
            className="fixed inset-0 bg-spa-charcoal/95 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-8"
          >
            <button
              onClick={closeVideoModal}
              aria-label="Close video"
              className="absolute top-6 right-6 text-white hover:text-spa-gold transition-colors p-2 bg-white/5 rounded-full z-10"
            >
              <X className="w-6 h-6" />
            </button>

            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="max-w-md w-full flex flex-col gap-4 text-center"
            >
              <div className="relative rounded shadow-2xl border border-white/10 overflow-hidden bg-black">
                <video
                  ref={videoModalRef}
                  key={activeVideoModal.videoUrl}
                  src={activeVideoModal.videoUrl}
                  autoPlay
                  muted={false}
                  controls
                  playsInline
                  className="w-full max-h-[80vh] mx-auto"
                />
              </div>
              <div className="space-y-1">
                <h3 className="font-serif text-2xl text-white font-medium">{activeVideoModal.title}</h3>
                <p className="text-spa-gold text-xs uppercase tracking-widest font-bold capitalize">{activeVideoModal.category}</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* Booking History / My Bookings Dashboard Section */}
      <section id="my-bookings" className="py-24 bg-spa-cream relative border-t border-spa-taupe">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
            <span className="text-spa-gold text-xs uppercase tracking-[0.3em] font-semibold block">Your Experience</span>
            <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal">My Saved Sessions</h2>
            <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
            <p className="text-spa-clay text-sm font-light mt-4">
              Review, print your active booking passes, or manage your scheduling.
            </p>
          </div>

          {bookings.length === 0 ? (
            <div className="bg-white border border-spa-taupe p-12 text-center rounded space-y-4 shadow-sm">
              <Calendar className="w-12 h-12 text-spa-gold/40 mx-auto" />
              <p className="text-spa-clay font-light text-base">You do not have any pending or saved bookings in this session.</p>
              <a 
                href="#booking"
                className="inline-block bg-spa-charcoal hover:bg-spa-gold text-spa-cream hover:text-spa-charcoal px-6 py-3 text-xs uppercase tracking-widest font-bold transition-all rounded"
              >
                Schedule Your First Massage
              </a>
            </div>
          ) : (
            <div className="space-y-6">
              {bookings.map((booking) => (
                <div 
                  key={booking.id}
                  className="bg-white border border-spa-taupe p-6 rounded shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-6"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded bg-spa-linen border border-spa-taupe flex items-center justify-center text-spa-gold flex-shrink-0 mt-1">
                      <Heart className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h4 className="font-serif text-lg font-bold text-spa-charcoal">{booking.service.name}</h4>
                        <span className="text-[10px] font-bold bg-spa-linen border border-spa-taupe text-spa-gold px-2 py-0.5 rounded-full uppercase tracking-wider">
                          ID: {booking.id}
                        </span>
                      </div>
                      <p className="text-xs text-spa-clay font-light">
                        Scheduled for <strong>{booking.date}</strong> at <strong>{booking.time}</strong>
                      </p>
                      <p className="text-[11px] text-spa-clay font-medium italic">
                        Venue: {booking.address}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 w-full md:w-auto justify-end border-t md:border-t-0 pt-4 md:pt-0">
                    <button 
                      onClick={() => {
                        setBookingRefId(booking.id);
                        setBookingPass(booking);
                        setBookingStep(5);
                        const element = document.getElementById('booking');
                        if (element) {
                          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                      }}
                      className="border border-spa-taupe hover:bg-spa-linen text-spa-charcoal px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>View Pass</span>
                    </button>
                    <button 
                      onClick={() => handleCancelBooking(booking.id)}
                      className="border border-red-200 hover:bg-red-50 text-red-600 px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Cancel</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

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
              href={`https://wa.me/2348118599365?text=${encodeURIComponent("Hi! I'd like to purchase an SMM (Sweet Mobile Massage and Spa) gift card.")}`}
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
              href={`https://wa.me/2348118599365?text=${encodeURIComponent("Hi! I'd like to join the SMM Wellness Circle membership.")}`}
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
                  <a href="tel:+2348118599365" className="hover:text-spa-gold transition-colors">+234 811 859 9365</a>
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
