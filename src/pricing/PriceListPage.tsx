import { ArrowLeft, CalendarCheck, Download, Mail, MapPin, MessageCircle, Phone, Printer } from 'lucide-react';
import { focusRing } from '../booking/components/ui';
import { contactDetails, whatsappUrl } from '../config/business';
import { PRICE_LIST, PRICE_LIST_UPDATED, priceText, type PriceItem } from '../content/priceList';
import { PRICE_LIST_PDF } from '../routes';

// The Full Price List page (?view=prices): every service the spa offers, with
// its price, from src/content/priceList.ts. Also prints cleanly (the same
// content is the downloadable PDF).

function enquiry(item: PriceItem): string {
  return whatsappUrl(`Hello, I am interested in the ${item.name} (${priceText(item)}). Kindly provide me with more information.`);
}

export default function PriceListPage() {
  const contact = contactDetails();
  const phones = [contact.phone, contact.phoneSecondary, contact.phoneThird].filter((p): p is NonNullable<typeof p> => !!p);
  const sections = PRICE_LIST.flatMap((g) => g.sections);

  return (
    <div className="min-h-screen bg-spa-cream text-spa-charcoal print:bg-white">
      <header className="bg-spa-charcoal print:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <a href="/" className={`shrink-0 rounded ${focusRing}`}>
            <img src="/assets/images/smm_logo_cropped.png" alt="SMM (Sweet Mobile Massage and Spa) — back to the website" className="h-12 w-auto sm:h-14" />
          </a>
          <nav aria-label="Price list" className="flex items-center gap-2 sm:gap-5">
            <a href="/#services" className={`hidden min-h-11 items-center gap-1.5 rounded px-2 text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold sm:inline-flex ${focusRing}`}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to website
            </a>
            <a href="/#booking" className={`inline-flex min-h-11 items-center gap-2 rounded bg-spa-gold px-4 text-xs font-bold uppercase tracking-widest text-spa-charcoal hover:bg-white sm:px-5 ${focusRing}`}>
              <CalendarCheck className="h-4 w-4" aria-hidden="true" />
              Book now
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-20 pt-12 sm:px-6 sm:pt-16 print:max-w-none print:p-0">
        <div className="mx-auto max-w-2xl space-y-4 text-center print:space-y-2">
          <div className="flex items-center justify-center gap-4" aria-hidden="true">
            <img src="/assets/images/pricelist/smm-logo.jpg" alt="" className="h-16 w-auto rounded-sm sm:h-20 print:h-14" />
            <img src="/assets/images/pricelist/bmm-logo.jpg" alt="" className="h-16 w-auto rounded-sm sm:h-20 print:h-14" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-spa-gold-dark">SMM / BMM Spa · Wellness · Beauty · Relaxation</p>
          <h1 className="font-serif text-4xl text-spa-charcoal md:text-6xl print:text-3xl">
            Full <span className="italic">Price List</span>
          </h1>
          <div className="mx-auto h-px w-12 bg-spa-gold" aria-hidden="true" />
          <p className="text-sm font-light text-spa-clay-text sm:text-base print:hidden">
            Every treatment we offer, with its price. Tap the WhatsApp icon beside any service to ask about it or book it.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-3 print:hidden">
          <a href={PRICE_LIST_PDF} download className={`inline-flex min-h-11 items-center gap-2 rounded bg-spa-charcoal px-5 py-3 text-xs font-bold uppercase tracking-widest text-spa-cream hover:bg-black ${focusRing}`}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download PDF
          </a>
          <button type="button" onClick={() => window.print()} className={`inline-flex min-h-11 items-center gap-2 rounded border border-spa-charcoal px-5 py-3 text-xs font-bold uppercase tracking-widest text-spa-charcoal hover:bg-spa-charcoal hover:text-spa-cream ${focusRing}`}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print
          </button>
        </div>

        <nav aria-label="Price list sections" className="mt-8 print:hidden">
          <ul className="flex flex-wrap justify-center gap-2">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={`inline-flex min-h-11 items-center rounded-full border border-spa-taupe bg-white px-4 text-xs font-semibold uppercase tracking-wider text-spa-charcoal hover:border-spa-charcoal ${focusRing}`}>
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {PRICE_LIST.map((group) => (
          <div key={group.title} className="mt-12 print:mt-4">
            {group.sections.map((section) => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="mt-10 scroll-mt-6 first:mt-0 print:mt-4">
                <h2 id={`${section.id}-title`} className="font-serif text-2xl text-spa-charcoal sm:text-3xl print:text-lg print:break-after-avoid">{section.title}</h2>
                {section.intro && <p className="mt-1 text-xs text-spa-clay-text sm:text-sm">{section.intro}</p>}
                <ul className="mt-4 divide-y divide-spa-taupe rounded border border-spa-taupe bg-white print:mt-2">
                  {section.items.map((item) => (
                    <li key={item.name} className="flex items-center justify-between gap-3 px-4 py-3 print:py-1 print:break-inside-avoid">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-spa-charcoal sm:text-base print:text-[13px]">{item.name}</p>
                        {item.note && <p className="text-xs text-spa-clay-text">{item.note}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <p className="text-right font-serif text-base font-semibold text-spa-gold-dark sm:text-lg print:text-[13px]">
                          {item.home ? (
                            <>
                              <span className="block">{priceText({ ...item, home: undefined })} <span className="font-sans text-xs font-normal text-spa-clay-text">at the spa</span></span>
                              <span className="block">{priceText({ name: item.name, price: item.home })} <span className="font-sans text-xs font-normal text-spa-clay-text">at home</span></span>
                            </>
                          ) : priceText(item)}
                        </p>
                        <a href={enquiry(item)} target="_blank" rel="noopener noreferrer" aria-label={`Ask about ${item.name} on WhatsApp`}
                          className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-[#128C7E] hover:bg-spa-linen print:hidden ${focusRing}`}>
                          <MessageCircle className="h-5 w-5" aria-hidden="true" />
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ))}

        <section aria-labelledby="book-title" className="mt-14 rounded border border-spa-gold-dark/40 bg-spa-linen p-6 text-center print:mt-5 print:p-4 print:break-inside-avoid">
          <h2 id="book-title" className="font-serif text-2xl text-spa-charcoal print:text-lg">Book your spa experience</h2>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
              <Phone className="h-4 w-4 text-spa-gold-dark" aria-hidden="true" />
              <span className="sr-only">Call:</span>
              {phones.map((p, i) => (
                <span key={p.tel}>
                  <a href={`tel:${p.tel}`} className={`rounded underline-offset-4 hover:underline ${focusRing}`}>{p.display}</a>
                  {i < phones.length - 1 && <span className="ml-3 text-spa-clay-text" aria-hidden="true">|</span>}
                </span>
              ))}
            </li>
            {contact.email && (
              <li className="flex items-center justify-center gap-2">
                <Mail className="h-4 w-4 text-spa-gold-dark" aria-hidden="true" />
                <a href={`mailto:${contact.email}`} className={`rounded underline-offset-4 hover:underline ${focusRing}`}>{contact.email}</a>
              </li>
            )}
            {contact.address && (
              <li className="flex items-center justify-center gap-2">
                <MapPin className="h-4 w-4 text-spa-gold-dark" aria-hidden="true" />
                <span>{contact.address}</span>
              </li>
            )}
          </ul>
          <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row print:hidden">
            <a href="/#booking" className={`inline-flex min-h-11 items-center justify-center gap-2 rounded bg-spa-gold px-6 py-3 text-xs font-bold uppercase tracking-widest text-spa-charcoal hover:bg-spa-gold-dark hover:text-white ${focusRing}`}>
              <CalendarCheck className="h-4 w-4" aria-hidden="true" />
              Book online
            </a>
            <a href={whatsappUrl('Hello! I would like to book a treatment from your price list.')} target="_blank" rel="noopener noreferrer"
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded bg-[#25D366] px-6 py-3 text-xs font-bold uppercase tracking-widest text-spa-charcoal hover:brightness-95 ${focusRing}`}>
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Book on WhatsApp
            </a>
          </div>
        </section>

        <p className="mt-8 text-center text-xs text-spa-clay-text">
          Prices as of {PRICE_LIST_UPDATED}. Please contact the spa to confirm details before booking.
        </p>
      </main>
    </div>
  );
}
