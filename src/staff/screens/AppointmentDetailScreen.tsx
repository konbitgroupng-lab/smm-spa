import { useState, type FormEvent, type ReactNode } from 'react';
import { formatTime, localDateOf } from '../../booking/dates';
import { messageFor, StaffError, type StaffRole } from '../lib/backend';
import { PAYMENT_LABEL, SETTLEMENT_LABEL, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE } from '../lib/labels';
import type { AppointmentDetail, BookingOptions, StaffOps } from '../lib/ops';
import { zonedInstant } from '../lib/time';
import { useLoad } from '../lib/useLoad';
import { href } from '../router';
import {
  Badge, Button, CheckboxField, ChoiceGroup, ErrorMessage, Field, LoadState, Notice, PageTitle, Panel, SelectField, TextAreaField,
} from '../ui';
import { dateTime, HistoryList, money, timeRange } from './common';
import { TransfersPanel } from './TransfersPanel';

/** A form that runs one staff action and reports the outcome. */
function ActionForm({ submitLabel, tone = 'primary', onSubmit, children }: {
  submitLabel: string;
  tone?: 'primary' | 'danger';
  onSubmit: () => Promise<string | void>;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setDone('');
    try {
      setDone((await onSubmit()) || '');
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <ErrorMessage>{error}</ErrorMessage>
      <Notice>{done}</Notice>
      {children}
      <Button type="submit" tone={tone} busy={busy}>{busy ? 'Saving…' : submitLabel}</Button>
    </form>
  );
}

export function AppointmentDetailScreen({ ops, id, role }: { ops: StaffOps; id: string; role: StaffRole }) {
  const detail = useLoad(() => ops.appointmentDetail(id), [ops, id]);
  const options = useLoad(() => ops.bookingOptions(), [ops]);
  return (
    <div>
      <p className="mb-2 text-sm"><a className="underline underline-offset-2" href={href('bookings')}>← All bookings</a></p>
      <LoadState ready={!!detail.data && !!options.data} error={detail.error || options.error} onRetry={() => { void detail.reload(); void options.reload(); }}>
        {() => <Detail d={detail.data!} options={options.data!} ops={ops} role={role} reload={detail.reload} />}
      </LoadState>
    </div>
  );
}

function Detail({ d, options, ops, role, reload }: {
  d: AppointmentDetail;
  options: BookingOptions;
  ops: StaffOps;
  role: StaffRole;
  reload: () => Promise<void>;
}) {
  const a = d.appointment;
  const started = new Date(a.startsAt).getTime() <= Date.now();
  const open = a.status === 'confirmed' || a.status === 'pending_payment';
  const therapistNames = Object.fromEntries(options.therapists.map((t) => [t.id, t.name]));
  const [notice, setNotice] = useState('');
  // A change can replace the form that made it, so its confirmation is shown at the top.
  const after = async (message: string) => {
    await reload();
    setNotice(message);
    return '';
  };

  return (
    <div>
      <PageTitle>Booking {a.reference}</PageTitle>
      <Notice>{notice}</Notice>
      <p className="-mt-4 mb-6 flex flex-wrap gap-2">
        <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
        <Badge>{SOURCE_LABEL[a.source]}</Badge>
        <Badge>{a.source === 'online' ? PAYMENT_LABEL[a.paymentState] : SETTLEMENT_LABEL[a.settlement]}</Badge>
        {a.isDemo && <Badge tone="bg-amber-100 text-amber-900">Demo</Badge>}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Appointment">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-spa-clay">When</dt><dd>{dateTime(a.startsAt)} ({timeRange(a.startsAt, a.endsAt)})</dd>
            <dt className="text-spa-clay">Treatment</dt><dd>{a.serviceName}</dd>
            <dt className="text-spa-clay">Therapist</dt><dd>{a.therapistName}</dd>
            <dt className="text-spa-clay">Where</dt>
            <dd>{a.locationType === 'mobile' ? `In-home · ${a.zoneName ?? ''}` : 'At the spa'}{a.serviceAddress && <><br />{a.serviceAddress}</>}</dd>
            <dt className="text-spa-clay">Price</dt>
            <dd>{money(a.totalMinor, a.currency)}{a.dispatchFeeMinor > 0 && ` (includes ${money(a.dispatchFeeMinor, a.currency)} travel)`}</dd>
            <dt className="text-spa-clay">Booked</dt><dd>{SOURCE_LABEL[a.source]}{a.createdByName && ` by ${a.createdByName}`}, {dateTime(a.createdAt)}</dd>
            {a.status === 'cancelled' && (<><dt className="text-spa-clay">Cancelled</dt><dd>{a.cancelledAt && dateTime(a.cancelledAt)}: {a.cancellationReason}</dd></>)}
          </dl>
        </Panel>

        <Panel title="Guest">
          <p className="text-sm font-medium">Contact for this booking</p>
          <p className="text-sm mb-3">{a.contactName ?? d.customer.fullName}{(a.contactPhone ?? d.customer.phone) && ` · ${a.contactPhone ?? d.customer.phone}`}</p>
          <p className="text-sm font-medium">Customer record</p>
          <p className="text-sm">
            <a className="underline underline-offset-2" href={href('customers', [d.customer.id])}>{d.customer.fullName}</a>
            {d.customer.email && ` · ${d.customer.email}`}{d.customer.phone && ` · ${d.customer.phone}`}
          </p>
          <p className="text-xs text-spa-clay mt-2">The booking keeps the contact given for it; editing one never changes the other.</p>
          {a.customerNotes && (<><p className="text-sm font-medium mt-3">Guest's notes</p><p className="text-sm whitespace-pre-line">{a.customerNotes}</p></>)}
          {a.bookingNotes && (<><p className="text-sm font-medium mt-3">Booking notes (shown to the therapist)</p><p className="text-sm whitespace-pre-line">{a.bookingNotes}</p></>)}
        </Panel>

        <StatusPanel key={`s-${a.updatedAt}`} d={d} ops={ops} role={role} started={started} after={after} />

        {open && !started && <ReschedulePanel key={`r-${a.updatedAt}`} d={d} options={options} ops={ops} after={after} />}

        {a.status !== 'cancelled' && <DetailsPanel key={`d-${a.updatedAt}`} d={d} ops={ops} after={after} />}

        {a.settlement === 'bank_transfer' && a.paymentState === 'awaiting_transfer' && (
          <TransferForBooking ops={ops} appointmentId={a.id} after={after} />
        )}

        {a.source !== 'online' && (
          <Panel title="Settlement">
            <p className="text-sm mb-3">Phone and WhatsApp bookings are never part of the online payment records. Record here whether the guest pays at the venue or has paid offline.</p>
            <SettlementForm key={`m-${a.updatedAt}`} d={d} ops={ops} after={after} />
          </Panel>
        )}

        <Panel title="Online payments">
          {d.payments.length ? (
            <ul className="space-y-2 text-sm">
              {d.payments.map((p) => (
                <li key={p.reference}>
                  {money(p.paidMinor ?? p.amountMinor, p.currency)} · {p.kind === 'deposit' ? 'Deposit' : 'Full payment'} · {p.status.replace(/_/g, ' ')}
                  {p.isDemo && ' (demo)'}
                  {p.needsRefund && <><br /><strong>Refund needed</strong> ({(p.needsRefundReason ?? '').replace(/_/g, ' ')}) · refund {p.refundStatus.replace(/_/g, ' ')}</>}
                  {p.refundedMinor > 0 && <><br />Refunded {money(p.refundedMinor, p.currency)}</>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-spa-clay">{a.source === 'online' ? 'No payment linked.' : 'None: this booking is settled outside the online payment system.'}</p>
          )}
          <p className="text-xs text-spa-clay mt-2">Read-only. Refunds are not issued from here.</p>
        </Panel>

        {open && <CancelPanel key={`c-${a.updatedAt}`} d={d} ops={ops} after={after} />}

        <Panel title="History">
          <HistoryList entries={d.history} therapistNames={therapistNames} />
        </Panel>
      </div>
    </div>
  );
}

type After = (message: string) => Promise<string>;

/** This booking's bank transfer, from the list of transfers awaiting confirmation. */
function TransferForBooking({ ops, appointmentId, after }: { ops: StaffOps; appointmentId: string; after: After }) {
  const transfers = useLoad(() => ops.transfers(), [ops]);
  const mine = (transfers.data ?? []).filter((t) => t.appointmentId === appointmentId);
  if (!transfers.data) return null;
  return <TransfersPanel ops={ops} transfers={mine} reload={transfers.reload} onConfirmed={(m) => void after(m)} />;
}

function StatusPanel({ d, ops, role, started, after }: { d: AppointmentDetail; ops: StaffOps; role: StaffRole; started: boolean; after: After }) {
  const a = d.appointment;
  const [target, setTarget] = useState<'completed' | 'no_show' | 'confirmed'>(a.status === 'completed' ? 'no_show' : 'completed');
  const [reason, setReason] = useState('');
  if (a.status === 'cancelled' || a.status === 'pending_payment') return null;
  if (a.status === 'confirmed') {
    return (
      <Panel title="Outcome">
        {started ? (
          <div className="flex flex-wrap gap-2">
            <ActionForm submitLabel="Mark completed" onSubmit={async () => { await ops.setStatus(a.id, 'completed', a.updatedAt); return after('Marked completed.'); }} />
            <ActionForm submitLabel="Mark no-show" onSubmit={async () => { await ops.setStatus(a.id, 'no_show', a.updatedAt); return after('Marked as a no-show.'); }} />
          </div>
        ) : (
          <p className="text-sm text-spa-clay">Can be marked completed or no-show once it has started.</p>
        )}
      </Panel>
    );
  }
  if (role === 'therapist') return null;
  return (
    <Panel title="Correct the outcome">
      <ActionForm submitLabel="Correct status" onSubmit={async () => { await ops.setStatus(a.id, target, a.updatedAt, reason); return after('Status corrected.'); }}>
        <SelectField label="Change to" value={target} onChange={(v) => setTarget(v as typeof target)}
          options={(['completed', 'no_show', 'confirmed'] as const).filter((s) => s !== a.status).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        <TextAreaField label="Reason" value={reason} onChange={setReason} required rows={2} />
      </ActionForm>
    </Panel>
  );
}

function ReschedulePanel({ d, options, ops, after }: { d: AppointmentDetail; options: BookingOptions; ops: StaffOps; after: After }) {
  const a = d.appointment;
  const [date, setDate] = useState(localDateOf(a.startsAt));
  const [time, setTime] = useState(formatTime(a.startsAt));
  const [therapistId, setTherapistId] = useState(a.therapistId);
  const [reason, setReason] = useState('');
  const [blockedRule, setBlockedRule] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [free, setFree] = useState<string[] | null>(null);
  const therapists = options.therapists.filter((t) => t.serviceIds.includes(a.serviceId) || t.id === a.therapistId);

  async function findFree() {
    const slots = await ops.availableSlots(a.serviceId, date, therapistId);
    setFree(slots.map((s) => formatTime(s.startsAt)));
  }

  return (
    <Panel title="Reschedule">
      <ActionForm submitLabel={override ? 'Move, overriding the rule' : 'Move booking'} onSubmit={async () => {
        try {
          await ops.reschedule(a.id, zonedInstant(date, time), reason, a.updatedAt, therapistId === a.therapistId ? null : therapistId, override);
        } catch (err) {
          if (err instanceof StaffError && err.code === 'schedule_rule' && err.detail) setBlockedRule(err.detail);
          throw err;
        }
        setBlockedRule(null);
        setOverride(false);
        return after('Booking moved.');
      }}>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="New date" type="date" value={date} onChange={(v) => { setDate(v); setFree(null); setBlockedRule(null); setOverride(false); }} />
          <Field label="New start time" type="time" value={time} onChange={(v) => { setTime(v); setBlockedRule(null); setOverride(false); }} />
        </div>
        <SelectField label="Therapist" value={therapistId} onChange={(v) => { setTherapistId(v); setFree(null); setBlockedRule(null); setOverride(false); }}
          options={therapists.map((t) => ({ value: t.id, label: t.name }))} />
        <div className="mb-4">
          <Button onClick={() => void findFree()}>Show free times</Button>
          {free && (
            free.length ? (
              <div className="mt-2" role="group" aria-label="Free times">
                <p className="text-xs text-spa-clay mb-1">Free start times (the booking's current time shows as taken):</p>
                <div className="flex flex-wrap gap-1">
                  {free.map((t) => (
                    <button key={t} type="button" onClick={() => { setTime(t); setBlockedRule(null); setOverride(false); }}
                      aria-pressed={t === time} className={`rounded border px-2 py-1 text-sm ${t === time ? 'border-spa-charcoal bg-spa-linen' : 'border-spa-taupe bg-white'}`}>{t}</button>
                  ))}
                </div>
              </div>
            ) : <p className="mt-2 text-sm text-spa-clay">No free times that day.</p>
          )}
        </div>
        <TextAreaField label="Reason" value={reason} onChange={setReason} required rows={2} />
        {blockedRule && (
          <CheckboxField label="Book anyway, overriding this booking rule" checked={override} onChange={setOverride}
            hint="The override and your reason are recorded. Overlapping another booking is never allowed." />
        )}
      </ActionForm>
    </Panel>
  );
}

function DetailsPanel({ d, ops, after }: { d: AppointmentDetail; ops: StaffOps; after: After }) {
  const a = d.appointment;
  const [name, setName] = useState(a.contactName ?? d.customer.fullName);
  const [phone, setPhone] = useState(a.contactPhone ?? d.customer.phone ?? '');
  const [address, setAddress] = useState(a.serviceAddress ?? '');
  const [notes, setNotes] = useState(a.bookingNotes ?? '');
  const [reason, setReason] = useState('');
  return (
    <Panel title="Booking contact and notes">
      <ActionForm submitLabel="Save booking details" onSubmit={async () => {
        await ops.updateBookingDetails(a.id, a.updatedAt, {
          contactName: name, contactPhone: phone, serviceAddress: a.locationType === 'mobile' ? address : null,
          bookingNotes: notes || null, reason: reason || null,
        });
        return after('Booking details saved. The customer record is unchanged.');
      }}>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Contact name" value={name} onChange={setName} autoComplete="off" />
          <Field label="Contact phone" type="tel" value={phone} onChange={setPhone} autoComplete="off" />
        </div>
        {a.locationType === 'mobile' && <TextAreaField label="Address for the visit" value={address} onChange={setAddress} required rows={2} maxLength={300} />}
        <TextAreaField label="Booking notes" value={notes} onChange={setNotes} maxLength={2000} hint="Shown to the therapist for this booking." />
        <Field label="Reason (optional)" value={reason} onChange={setReason} required={false} />
      </ActionForm>
    </Panel>
  );
}

function SettlementForm({ d, ops, after }: { d: AppointmentDetail; ops: StaffOps; after: After }) {
  const a = d.appointment;
  const [value, setValue] = useState<'pay_at_venue' | 'paid_offline'>(a.settlement === 'paid_offline' ? 'paid_offline' : 'pay_at_venue');
  const [reason, setReason] = useState('');
  return (
    <ActionForm submitLabel="Save settlement" onSubmit={async () => {
      await ops.setSettlement(a.id, value, reason, a.updatedAt);
      return after('Settlement saved.');
    }}>
      <ChoiceGroup<'pay_at_venue' | 'paid_offline'> label="Settlement" value={value} onChange={setValue}
        options={[{ value: 'pay_at_venue', label: SETTLEMENT_LABEL.pay_at_venue }, { value: 'paid_offline', label: SETTLEMENT_LABEL.paid_offline }]} />
      <Field label="Reason" value={reason} onChange={setReason} hint="For example: bank transfer received." />
    </ActionForm>
  );
}

function CancelPanel({ d, ops, after }: { d: AppointmentDetail; ops: StaffOps; after: After }) {
  const a = d.appointment;
  const [reason, setReason] = useState('');
  const paidOnline = ['paid', 'deposit_paid'].includes(a.paymentState);
  return (
    <Panel title="Cancel booking">
      <p className="text-sm mb-3">
        The time becomes free for other bookings straight away.
        {paidOnline && ' The online payment will be flagged for a refund; no money is returned automatically.'}
        {a.settlement === 'paid_offline' && ' This booking was paid offline: arrange any refund with the guest directly.'}
        {a.paymentState === 'paid_transfer' && ' The guest paid by bank transfer: arrange any refund with them directly.'}
      </p>
      <ActionForm submitLabel="Cancel booking" tone="danger" onSubmit={async () => {
        const r = await ops.cancel(a.id, reason, a.updatedAt);
        return after(r.refundFlagged ? 'Booking cancelled. The online payment is flagged for a refund.' : 'Booking cancelled.');
      }}>
        <TextAreaField label="Reason for cancelling" value={reason} onChange={setReason} required rows={2} />
      </ActionForm>
    </Panel>
  );
}
