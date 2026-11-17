import { CalendarCheck, Check, CircleAlert, Copy, Landmark, MessageCircle, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { whatsappUrl } from '../config/business';
import { formatMoney } from '../lib/money';
import { getTransferBooking, type TransferBooking } from '../services/bookingService';
import { focusRing, PrimaryButton, SecondaryButton } from './components/ui';
import { DEFAULT_TIMEZONE, formatDateLong, formatTime, localDateOf } from './dates';
import { messageFor } from './messages';

// The guest's own page for a booking paid by direct bank transfer
// (?view=transfer&token=...). Everything shown comes from the server, read
// with the page's secret token; the booking is confirmed only when the spa
// has seen the transfer.

const CHECK_EVERY_MS = 30_000;

export interface TransferPageApi {
  getTransferBooking: typeof getTransferBooking;
}
const defaultApi: TransferPageApi = { getTransferBooking };

function Card({ icon, title, tone, children }: { icon: ReactNode; title: string; tone: 'good' | 'wait' | 'bad'; children: ReactNode }) {
  const toneClass = tone === 'good' ? 'text-green-800' : tone === 'bad' ? 'text-spa-berry' : 'text-spa-charcoal';
  return (
    <section className="space-y-5 rounded border border-spa-taupe bg-white p-6 shadow-2xl sm:p-10">
      <div className={`flex items-center gap-3 ${toneClass}`}>
        {icon}
        <h1 tabIndex={-1} className="font-serif text-2xl focus:outline-none sm:text-3xl" data-autofocus>
          {title}
        </h1>
      </div>
      <div className="space-y-4 text-sm text-spa-charcoal">{children}</div>
    </section>
  );
}

/** A value the guest copies into their banking app. */
function CopyRow({ label, value, display = value }: { label: string; value: string; display?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Copying is a convenience; the value is on screen to type.
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 border-b border-spa-taupe/60 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <dt className="text-xs uppercase tracking-widest text-spa-clay-text">{label}</dt>
        <dd className="break-words font-semibold text-spa-charcoal">{display}</dd>
      </div>
      <button type="button" onClick={() => void copy()} aria-label={`Copy ${label.toLowerCase()}`}
        className={`inline-flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center gap-1.5 rounded border border-spa-taupe px-3 text-xs text-spa-charcoal hover:border-spa-gold-dark ${focusRing}`}>
        {copied ? <Check className="h-4 w-4 text-green-800" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

export default function TransferBookingPage({
  token,
  api = defaultApi,
  timeZone = DEFAULT_TIMEZONE,
  checkEveryMs = CHECK_EVERY_MS,
}: {
  token: string;
  api?: TransferPageApi;
  timeZone?: string;
  checkEveryMs?: number;
}) {
  const [booking, setBooking] = useState<TransferBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setBooking(await api.getTransferBooking(token));
      setError(null);
    } catch (err) {
      setError((err as { code?: string })?.code ?? 'unknown');
    } finally {
      setChecking(false);
    }
  }, [api, token]);

  useEffect(() => {
    void check();
  }, [check]);

  // While the transfer is awaited, look again now and then: the page updates
  // by itself once the spa confirms it.
  useEffect(() => {
    if (booking?.status !== 'awaiting') return;
    const timer = setInterval(() => void check(), checkEveryMs);
    return () => clearInterval(timer);
  }, [booking?.status, check, checkEveryMs]);

  useEffect(() => {
    mainRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [booking?.status, error]);

  const when = booking && `${formatDateLong(localDateOf(booking.startsAt, timeZone))}, ${formatTime(booking.startsAt, timeZone)} – ${formatTime(booking.endsAt, timeZone)}`;
  const due = booking && `${formatTime(booking.dueAt, timeZone)} on ${formatDateLong(localDateOf(booking.dueAt, timeZone))}`;
  const amount = booking && formatMoney(booking.amountMinor, booking.currency);
  const proof = booking && whatsappUrl(
    `Hello, I have made a bank transfer of ${amount} for booking ${booking.reference} (${when}). Here is my proof of payment.`,
  );

  return (
    <div className="min-h-screen bg-spa-cream text-spa-charcoal">
      <header className="bg-spa-charcoal">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <a href="/" className={`rounded ${focusRing}`}>
            <img src="/assets/images/smm_logo_cropped.png" alt="SMM (Sweet Mobile Massage and Spa) — back to the website" className="h-14 w-auto" />
          </a>
          <a href="/" className={`min-h-11 content-center rounded px-2 text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold ${focusRing}`}>
            Back to website
          </a>
        </div>
      </header>

      <main ref={mainRef} className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6 sm:py-16">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-spa-gold-dark">Your booking</p>

        {!booking && !error && <p role="status" className="text-center text-sm text-spa-clay-text">Loading your booking…</p>}

        {!booking && error && (
          <Card icon={<CircleAlert className="h-7 w-7" aria-hidden="true" />} title="We could not open this booking" tone="bad">
            <p>{messageFor(error)}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <PrimaryButton onClick={() => void check()} busy={checking}><RotateCcw className="h-4 w-4" aria-hidden="true" />Try again</PrimaryButton>
              <a href={whatsappUrl('Hi! I have a question about my bank transfer booking.')} target="_blank" rel="noopener noreferrer"
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded border border-spa-taupe px-5 py-3 text-xs font-semibold uppercase tracking-widest ${focusRing}`}>
                <MessageCircle className="h-4 w-4" aria-hidden="true" />Message us on WhatsApp
              </a>
            </div>
          </Card>
        )}

        {booking?.status === 'awaiting' && booking.bank && (
          <Card icon={<Landmark className="h-7 w-7" aria-hidden="true" />} title="Your time is reserved: please make your transfer" tone="wait">
            <p>
              <strong>{when}</strong>. We hold this time for you until <strong>{due}</strong>. Your booking is confirmed as soon as we see
              your transfer; this page updates by itself.
            </p>

            <div className="rounded border-2 border-spa-charcoal bg-spa-cream p-5">
              <p className="text-xs font-bold uppercase tracking-widest">{booking.amountMinor < booking.bookingTotalMinor ? 'Deposit to transfer' : 'Amount to transfer'}</p>
              <p className="mt-1 font-serif text-3xl">{amount}</p>
              {booking.amountMinor < booking.bookingTotalMinor && (
                <p className="mt-1 text-sm text-spa-clay-text">
                  Deposit towards {formatMoney(booking.bookingTotalMinor, booking.currency)}. The balance is paid at your appointment.
                </p>
              )}
            </div>

            <dl className="rounded border border-spa-taupe px-4">
              <CopyRow label="Bank" value={booking.bank.name} />
              <CopyRow label="Account number" value={booking.bank.accountNumber} />
              <CopyRow label="Account name" value={booking.bank.accountName} />
              <CopyRow label="Amount" value={String(booking.amountMinor / 100)} display={amount!} />
              <CopyRow label="Reference (put this in the transfer description)" value={booking.reference} />
            </dl>

            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>Transfer exactly <strong>{amount}</strong> to the account above, with <strong>{booking.reference}</strong> as the description.</li>
              <li>Send us your proof of payment on WhatsApp, so we can confirm it quickly.</li>
              <li>Keep this page (bookmark it): it shows when your booking is confirmed.</li>
            </ol>

            <div className="flex flex-col gap-3 sm:flex-row">
              <a href={proof!} target="_blank" rel="noopener noreferrer"
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded bg-[#25D366] px-5 py-3 text-xs font-bold uppercase tracking-widest text-spa-charcoal hover:brightness-95 ${focusRing}`}>
                <MessageCircle className="h-4 w-4" aria-hidden="true" />Send proof on WhatsApp
              </a>
              <SecondaryButton onClick={() => void check()} disabled={checking} aria-busy={checking || undefined}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />{checking ? 'Checking…' : 'Check again'}
              </SecondaryButton>
            </div>
            <p className="text-xs text-spa-clay-text">
              If we have not seen your transfer by {due}, the reservation is cancelled and the time is offered to other guests. Transferred
              but running late? Message us on WhatsApp straight away.
            </p>
          </Card>
        )}

        {booking?.status === 'confirmed' && (
          <Card icon={<CalendarCheck className="h-7 w-7" aria-hidden="true" />} title="Your booking is confirmed" tone="good">
            <p>Thank you: we have received your transfer. We look forward to welcoming you.</p>
            <dl className="grid grid-cols-1 gap-3 rounded border border-spa-taupe p-4 sm:grid-cols-2">
              <div><dt className="text-xs uppercase tracking-widest text-spa-clay-text">When (Lagos time)</dt><dd className="font-semibold">{when}</dd></div>
              <div><dt className="text-xs uppercase tracking-widest text-spa-clay-text">Booking reference</dt><dd className="font-semibold">{booking.reference}</dd></div>
            </dl>
            <p>Please keep your booking reference. To change or cancel, message us on WhatsApp or call us at least 24 hours before your appointment.</p>
          </Card>
        )}

        {booking?.status === 'cancelled' && (
          <Card icon={<CircleAlert className="h-7 w-7" aria-hidden="true" />} title="This booking has been cancelled" tone="bad">
            <p>
              {booking.expired
                ? `We did not receive the transfer for ${booking.reference} in time, so the reserved time was released.`
                : `Booking ${booking.reference} has been cancelled.`}{' '}
              If you have already transferred the money, message us on WhatsApp with your proof of payment and we will sort it out.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a href={whatsappUrl(`Hi! About booking ${booking.reference}: I have a question about my bank transfer.`)} target="_blank" rel="noopener noreferrer"
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded border border-spa-taupe px-5 py-3 text-xs font-semibold uppercase tracking-widest ${focusRing}`}>
                <MessageCircle className="h-4 w-4" aria-hidden="true" />Message us on WhatsApp
              </a>
              <a href="/#booking" className={`inline-flex min-h-11 items-center justify-center rounded bg-spa-charcoal px-5 py-3 text-xs font-bold uppercase tracking-widest text-spa-cream ${focusRing}`}>
                Book again
              </a>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
