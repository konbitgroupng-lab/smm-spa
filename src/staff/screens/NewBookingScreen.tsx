import { useState, type FormEvent } from 'react';
import { formatTime } from '../../booking/dates';
import { messageFor } from '../lib/backend';
import type { BookingOptions, CustomerRow, Slot, StaffOps } from '../lib/ops';
import { localToday } from '../lib/time';
import { useLoad } from '../lib/useLoad';
import { href, navigate } from '../router';
import { Button, ChoiceGroup, ErrorMessage, Field, LoadState, PageTitle, Panel, SelectField, TextAreaField } from '../ui';
import { money } from './common';

/** Owner/admin: a booking taken by phone or WhatsApp. Same availability rules as online. */
export function NewBookingScreen({ ops }: { ops: StaffOps }) {
  const options = useLoad(() => ops.bookingOptions(), [ops]);
  return (
    <div>
      <p className="mb-2 text-sm"><a className="underline underline-offset-2" href={href('bookings')}>← All bookings</a></p>
      <PageTitle>New phone or WhatsApp booking</PageTitle>
      <LoadState ready={!!options.data} error={options.error} onRetry={options.reload}>
        {() => <NewBookingForm ops={ops} options={options.data!} />}
      </LoadState>
    </div>
  );
}

function NewBookingForm({ ops, options }: { ops: StaffOps; options: BookingOptions }) {
  const [source, setSource] = useState<'phone' | 'whatsapp'>('phone');
  const [settlement, setSettlement] = useState<'pay_at_venue' | 'paid_offline'>('pay_at_venue');
  const [customerMode, setCustomerMode] = useState<'new' | 'existing'>('new');
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<CustomerRow[] | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [serviceId, setServiceId] = useState(options.services[0]?.id ?? '');
  const [location, setLocation] = useState<'sanctuary' | 'mobile'>('sanctuary');
  const [zoneId, setZoneId] = useState(options.zones[0]?.id ?? '');
  const [address, setAddress] = useState('');
  const [therapistId, setTherapistId] = useState('');
  const [date, setDate] = useState(localToday());
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const service = options.services.find((s) => s.id === serviceId);
  const therapists = options.therapists.filter((t) => t.serviceIds.includes(serviceId));
  const therapistName = (id: string) => options.therapists.find((t) => t.id === id)?.name ?? '';
  const zone = options.zones.find((z) => z.id === zoneId);
  const resetSlots = () => { setSlots(null); setSlot(null); };

  async function findCustomers() {
    setError('');
    try {
      setMatches((await ops.customers(search, 8, 0)).rows);
    } catch (err) {
      setError(messageFor(err));
    }
  }

  async function findSlots() {
    setError('');
    setSlot(null);
    try {
      setSlots(await ops.availableSlots(serviceId, date, therapistId || null));
    } catch (err) {
      setError(messageFor(err));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!slot) return setError('Choose one of the free times.');
    if (customerMode === 'existing' && !customer) return setError('Choose the customer, or add a new one.');
    setBusy(true);
    setError('');
    try {
      const created = await ops.createBooking({
        source, settlement, serviceId, startsAt: slot.startsAt, therapistId: slot.therapistId,
        locationType: location, dispatchZoneId: location === 'mobile' ? zoneId : null, serviceAddress: location === 'mobile' ? address : null,
        customerId: customerMode === 'existing' ? customer!.id : null,
        customerName: customerMode === 'new' ? name : null, customerEmail: customerMode === 'new' ? email || null : null,
        customerPhone: customerMode === 'new' ? phone || null : null,
        contactName: contactName || null, contactPhone: contactPhone || null, bookingNotes: notes || null, reason,
      });
      navigate(href('bookings', [created.id]));
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-2 items-start">
      <Panel title="How it was booked">
        <ChoiceGroup<'phone' | 'whatsapp'> label="Booked by" value={source} onChange={setSource}
          options={[{ value: 'phone', label: 'Phone' }, { value: 'whatsapp', label: 'WhatsApp' }]} />
        <ChoiceGroup<'pay_at_venue' | 'paid_offline'> label="Payment" value={settlement} onChange={setSettlement}
          options={[{ value: 'pay_at_venue', label: 'Pays at the venue' }, { value: 'paid_offline', label: 'Already paid offline' }]} />
        <p className="text-xs text-spa-clay">Staff bookings are never part of the online payment records.</p>
      </Panel>

      <Panel title="Customer">
        <ChoiceGroup<'new' | 'existing'> label="Customer" value={customerMode} onChange={(v) => { setCustomerMode(v); setCustomer(null); }}
          options={[{ value: 'new', label: 'New or by email' }, { value: 'existing', label: 'Find existing' }]} />
        {customerMode === 'new' ? (
          <>
            <Field label="Full name" value={name} onChange={setName} autoComplete="off" />
            <div className="grid gap-x-3 sm:grid-cols-2">
              <Field label="Phone number" type="tel" value={phone} onChange={setPhone} autoComplete="off" required={false} />
              <Field label="Email (optional)" type="email" value={email} onChange={setEmail} autoComplete="off" required={false}
                hint="If this email is already on file, the booking is linked to that customer without changing their record." />
            </div>
          </>
        ) : customer ? (
          <div className="text-sm">
            <p><strong>{customer.fullName}</strong>{customer.phone && ` · ${customer.phone}`}{customer.email && ` · ${customer.email}`}</p>
            <button type="button" className="underline underline-offset-2 mt-1" onClick={() => setCustomer(null)}>Choose someone else</button>
          </div>
        ) : (
          <div>
            <div className="flex gap-2 items-end">
              <div className="flex-1"><Field label="Name, email or phone" value={search} onChange={setSearch} required={false} autoComplete="off" /></div>
              <div className="mb-4"><Button onClick={() => void findCustomers()}>Search</Button></div>
            </div>
            {matches && (matches.length ? (
              <ul className="space-y-1" aria-label="Matching customers">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => setCustomer(m)} className="w-full text-left rounded border border-spa-taupe bg-white px-3 py-2 text-sm hover:border-spa-charcoal">
                      {m.fullName}{m.phone && ` · ${m.phone}`}{m.email && ` · ${m.email}`}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-spa-clay">No matching customers.</p>)}
          </div>
        )}
      </Panel>

      <Panel title="Treatment and time">
        <SelectField label="Treatment" value={serviceId} onChange={(v) => { setServiceId(v); setTherapistId(''); resetSlots(); }}
          options={options.services.map((s) => ({ value: s.id, label: `${s.name} · ${s.durationMinutes} min · ${money(s.priceMinor, s.currency)}` }))} />
        <ChoiceGroup<'sanctuary' | 'mobile'> label="Where" value={location} onChange={(v) => { setLocation(v); resetSlots(); }}
          options={[{ value: 'sanctuary', label: 'At the spa' }, { value: 'mobile', label: 'In-home' }]} />
        {location === 'mobile' && (
          <>
            <SelectField label="Area" value={zoneId} onChange={setZoneId}
              options={options.zones.map((z) => ({ value: z.id, label: `${z.name}${z.feeMinor ? ` · travel ${money(z.feeMinor)}` : ''}` }))} />
            <TextAreaField label="Address for the visit" value={address} onChange={setAddress} required rows={2} maxLength={300} />
          </>
        )}
        <SelectField label="Therapist" value={therapistId} required={false} onChange={(v) => { setTherapistId(v); resetSlots(); }}
          options={[{ value: '', label: 'Any available therapist' }, ...therapists.map((t) => ({ value: t.id, label: t.name }))]} />
        <div className="flex gap-2 items-end">
          <div className="flex-1"><Field label="Date" type="date" value={date} onChange={(v) => { setDate(v); resetSlots(); }} /></div>
          <div className="mb-4"><Button onClick={() => void findSlots()}>Find free times</Button></div>
        </div>
        {slots && (slots.length ? (
          <div role="group" aria-label="Free times">
            <p className="text-sm mb-1">Free times</p>
            <div className="flex flex-wrap gap-2">
              {slots.map((s) => {
                const chosen = slot?.startsAt === s.startsAt && slot.therapistId === s.therapistId;
                return (
                  <button key={`${s.therapistId}-${s.startsAt}`} type="button" aria-pressed={chosen} onClick={() => setSlot(s)}
                    className={`rounded-lg border px-3 py-2 text-sm min-h-[40px] ${chosen ? 'border-spa-charcoal bg-spa-linen font-medium' : 'border-spa-taupe bg-white'}`}>
                    {formatTime(s.startsAt)}{!therapistId && ` · ${therapistName(s.therapistId)}`}
                  </button>
                );
              })}
            </div>
          </div>
        ) : <p className="text-sm text-spa-clay">No free times that day.</p>)}
        {service && (
          <p className="text-sm mt-3">
            Price: {money(service.priceMinor + (location === 'mobile' ? zone?.feeMinor ?? 0 : 0), service.currency)}
          </p>
        )}
      </Panel>

      <Panel title="Contact, notes and reason">
        <p className="text-xs text-spa-clay mb-3">Leave the contact blank to use the customer's name and phone. The contact is stored on this booking only.</p>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Contact name (optional)" value={contactName} onChange={setContactName} required={false} autoComplete="off" />
          <Field label="Contact phone (optional)" type="tel" value={contactPhone} onChange={setContactPhone} required={false} autoComplete="off" />
        </div>
        <TextAreaField label="Booking notes (optional)" value={notes} onChange={setNotes} maxLength={2000} hint="Shown to the therapist for this booking." />
        <Field label="Reason" value={reason} onChange={setReason} hint="Recorded with the booking, for example: called to book." />
        <ErrorMessage>{error}</ErrorMessage>
        <Button type="submit" tone="primary" busy={busy}>{busy ? 'Booking…' : 'Confirm booking'}</Button>
      </Panel>
    </form>
  );
}
