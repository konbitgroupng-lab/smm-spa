import { useEffect, useMemo, useState } from 'react';
import { formatMoney } from '../lib/money';
import { attachCustomer, createHold, getAvailableSlots, releaseHold, type BookingHold, type Slot } from '../services/bookingService';
import { getCatalog, getTherapists, type CatalogService, type CatalogTherapist } from '../services/catalogService';
import { startPayment, type PaymentStart } from '../services/paymentService';
import DemoPaymentNotice from '../booking/components/DemoPaymentNotice';
import { rememberPendingPayment } from '../booking/pendingPayment';
import PrototypeShell, { Button, ErrorMessage, formatSlot, messageFor, Panel } from './PrototypeShell';

// End-to-end booking flow on the real backend, without the public site's
// design: service -> therapist -> date -> time (hold) -> details -> payment.
// It exists so the booking and payment path can be exercised before the
// Phase 4 funnel is built. Every decision (availability, the hold, the amount,
// the outcome) is made by the server.

type Step = 'choose' | 'details' | 'pay';

function todayInLagos(offsetDays = 0): string {
  const lagos = new Date(Date.now() + 60 * 60 * 1000 + offsetDays * 86_400_000);
  return lagos.toISOString().slice(0, 10);
}

function useCountdown(expiresAt: string | undefined): string | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const left = Math.max(0, new Date(expiresAt).getTime() - now);
  return `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
}

export default function BookingPrototypePage() {
  const [services, setServices] = useState<CatalogService[]>([]);
  const [therapists, setTherapists] = useState<CatalogTherapist[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [therapistId, setTherapistId] = useState('');
  const [date, setDate] = useState(todayInLagos(1));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [hold, setHold] = useState<BookingHold | null>(null);
  const [payment, setPayment] = useState<PaymentStart | null>(null);
  const [step, setStep] = useState<Step>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState({ fullName: '', email: '', phone: '', notes: '' });
  const countdown = useCountdown(payment?.holdExpiresAt ?? hold?.expiresAt);

  useEffect(() => {
    Promise.all([getCatalog(), getTherapists()]).then(
      ([catalog, team]) => {
        setServices([...catalog.services, ...catalog.packages].filter((s) => s.dbId));
        setTherapists(team.filter((t) => t.dbId));
      },
      (err) => setError(messageFor(err)),
    );
  }, []);

  const service = useMemo(() => services.find((s) => s.dbId === serviceId), [services, serviceId]);

  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await task();
    } catch (err) {
      setError(messageFor(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const loadSlots = () => run(async () => setSlots(await getAvailableSlots(serviceId, date, therapistId || undefined)));

  const chooseSlot = (slot: Slot) =>
    run(async () => {
      const next = await createHold({
        serviceId,
        startsAt: slot.startsAt,
        therapistId: therapistId || undefined,
        replaceHoldToken: hold?.token, // changing time gives back the previous slot
      });
      setHold(next);
      setStep('details');
    });

  const submitDetails = () =>
    run(async () => {
      if (!hold) return;
      await attachCustomer(hold.token, { fullName: details.fullName, email: details.email, phone: details.phone });
      const start = await startPayment(hold.token, {
        notes: details.notes || undefined,
        callbackUrl: `${window.location.origin}/?view=payment-return`,
      });
      rememberPendingPayment(start.reference, { holdToken: hold.token, demo: start.demo });
      setPayment(start);
      setStep('pay');
    });

  const startOver = () =>
    run(async () => {
      if (hold) await releaseHold(hold.token).catch(() => undefined);
      setHold(null);
      setPayment(null);
      setSlots(null);
      setStep('choose');
    });

  const field = (name: keyof typeof details, label: string, type = 'text') => (
    <label className="block text-sm">
      <span className="text-spa-charcoal/70">{label}</span>
      <input
        type={type}
        value={details[name]}
        onChange={(e) => setDetails({ ...details, [name]: e.target.value })}
        className="mt-1 w-full rounded-md border border-spa-taupe px-3 py-2"
      />
    </label>
  );

  return (
    <PrototypeShell title="Book a treatment" subtitle="Prototype of the booking flow. The public booking funnel is built in Phase 4.">
      <ErrorMessage message={error} />

      {step === 'choose' && (
        <Panel>
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="text-spa-charcoal/70">Treatment</span>
              <select className="mt-1 w-full rounded-md border border-spa-taupe px-3 py-2" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setSlots(null); }}>
                <option value="">Choose…</option>
                {services.map((s) => (
                  <option key={s.dbId} value={s.dbId!}>
                    {s.name} — {s.duration} min — {s.formattedPrice}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-spa-charcoal/70">Therapist</span>
              <select className="mt-1 w-full rounded-md border border-spa-taupe px-3 py-2" value={therapistId} onChange={(e) => { setTherapistId(e.target.value); setSlots(null); }}>
                <option value="">Any available therapist</option>
                {therapists.map((t) => (
                  <option key={t.dbId} value={t.dbId!}>{t.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-spa-charcoal/70">Date</span>
              <input type="date" min={todayInLagos()} className="mt-1 w-full rounded-md border border-spa-taupe px-3 py-2" value={date} onChange={(e) => { setDate(e.target.value); setSlots(null); }} />
            </label>
            <Button onClick={() => void loadSlots()} disabled={!serviceId || !date || busy}>Show available times</Button>
          </div>
          {slots && (
            <div className="mt-5">
              {slots.length === 0 ? (
                <p className="text-sm">No times available on this date.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((slot) => (
                    <button key={slot.startsAt} disabled={busy} onClick={() => void chooseSlot(slot)} className="rounded-md border border-spa-taupe px-2 py-2 text-sm hover:bg-spa-linen disabled:opacity-50">
                      {formatSlot(slot.startsAt).split(', ').pop()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Panel>
      )}

      {step !== 'choose' && hold && (
        <Panel>
          <p className="text-sm">
            <strong>{service?.name}</strong> on {formatSlot(hold.startsAt)} (Lagos time)
          </p>
          <p className="mt-1 text-xs text-spa-charcoal/70">This time is reserved for you for {countdown}. Payment confirms the booking.</p>
        </Panel>
      )}

      {step === 'details' && (
        <Panel>
          <div className="space-y-3">
            {field('fullName', 'Full name')}
            {field('email', 'Email', 'email')}
            {field('phone', 'Phone', 'tel')}
            {field('notes', 'Anything your therapist should know (optional)')}
            <Button onClick={() => void submitDetails()} disabled={busy}>Continue to payment</Button>
            <Button variant="secondary" onClick={() => setStep('choose')} disabled={busy}>Choose a different time</Button>
          </div>
        </Panel>
      )}

      {step === 'pay' && payment && (
        <>
          {payment.demo && <DemoPaymentNotice />}
          <Panel>
            <p className="text-sm text-spa-charcoal/70">{payment.kind === 'deposit' ? 'Deposit due now' : 'Amount due'}</p>
            <p className="text-2xl font-semibold">{formatMoney(payment.amountMinor, payment.currency)}</p>
            {payment.kind === 'deposit' && (
              <p className="text-xs text-spa-charcoal/70">of {formatMoney(payment.bookingTotalMinor, payment.currency)} in total</p>
            )}
            <div className="mt-4">
              <Button onClick={() => window.location.assign(payment.checkoutUrl)}>{payment.demo ? 'Continue to demo checkout' : 'Continue to secure payment'}</Button>
            </div>
          </Panel>
        </>
      )}

      {step !== 'choose' && (
        <Button variant="danger" onClick={() => void startOver()} disabled={busy}>Cancel and release this time</Button>
      )}
    </PrototypeShell>
  );
}
