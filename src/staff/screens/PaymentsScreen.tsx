import { useState } from 'react';
import { messageFor, type StaffRole } from '../lib/backend';
import { PAYMENT_STATUS_LABEL, REFUND_METHOD_LABEL, REFUND_REASON_LABEL, STATUS_LABEL } from '../lib/labels';
import type { PaymentDetail, PaymentFilter, PaymentRow, RefundMethod, StaffOps } from '../lib/ops';
import { useLoad } from '../lib/useLoad';
import { href, type Route } from '../router';
import { Badge, Button, ChoiceGroup, ErrorMessage, Field, LoadState, PageTitle, Panel } from '../ui';
import { ChangeForm } from './ChangeForm';
import { dateTime, HistoryList, money } from './common';

const FILTERS: { id: PaymentFilter; label: string }[] = [
  { id: 'refund_due', label: 'Refund needed' },
  { id: 'all', label: 'All' },
  { id: 'succeeded', label: 'Paid' },
  { id: 'pending', label: 'In progress' },
  { id: 'failed', label: 'Failed' },
  { id: 'abandoned', label: 'Abandoned' },
  { id: 'refunded', label: 'Refunded' },
];
const PAGE = 50;

function DemoBadge({ p }: { p: { isDemo: boolean; provider: string } }) {
  return p.isDemo || p.provider === 'mock' ? <Badge tone="bg-amber-100 text-amber-900">Demo payment</Badge> : null;
}

/** Owner/admin: payments, read-only, and the queue of payments needing a refund. */
export function PaymentsScreen({ ops, route, role }: { ops: StaffOps; route: Route; role: StaffRole }) {
  const [sub] = route.path;
  if (sub) return <PaymentDetailScreen key={sub} ops={ops} id={sub} role={role} />;
  const filter = (FILTERS.find((f) => f.id === route.params.get('filter'))?.id ?? 'refund_due') as PaymentFilter;
  return (
    <div>
      <PageTitle>Payments</PageTitle>
      <p className="text-sm -mt-4 mb-4">Payments are recorded by the payment system and cannot be edited here. Refunds are never sent from this app.</p>
      <nav aria-label="Payment filters" className="mb-6">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <li key={f.id}>
              <a href={href('payments', [], { filter: f.id })} aria-current={f.id === filter ? 'page' : undefined}
                className={`inline-block rounded-lg border px-3 py-2 text-sm ${f.id === filter ? 'border-spa-charcoal bg-spa-linen font-medium' : 'border-spa-taupe bg-white'}`}>{f.label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <PaymentList key={filter} ops={ops} filter={filter} />
    </div>
  );
}

function PaymentList({ ops, filter }: { ops: StaffOps; filter: PaymentFilter }) {
  const first = useLoad(() => ops.payments(filter, PAGE, 0), [ops, filter]);
  const [extra, setExtra] = useState<PaymentRow[]>([]);
  const [error, setError] = useState('');
  const rows = [...(first.data?.rows ?? []), ...extra];
  return (
    <LoadState ready={!!first.data} error={first.error} onRetry={first.reload}>
      {() => (
        <>
          <p className="text-sm mb-3" aria-live="polite">{first.data!.total} {first.data!.total === 1 ? 'payment' : 'payments'}</p>
          {rows.length ? (
            <ul className="grid gap-2 md:grid-cols-2">
              {rows.map((p) => (
                <li key={p.id}>
                  <a href={href('payments', [p.id])} className="block rounded-lg border border-spa-taupe bg-white p-3 hover:border-spa-charcoal">
                    <span className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">{money(p.paidMinor ?? p.amountMinor, p.currency)} · {PAYMENT_STATUS_LABEL[p.status] ?? p.status}</span>
                      <span className="flex gap-1">{p.needsRefund && p.refundableMinor > 0 && <Badge tone="bg-red-100 text-red-900">Refund needed</Badge>}<DemoBadge p={p} /></span>
                    </span>
                    <span className="block text-sm">{p.guestName ?? 'Guest'}{p.serviceName && ` · ${p.serviceName}`}{p.startsAt && ` · ${dateTime(p.startsAt)}`}</span>
                    {p.needsRefundReason && <span className="block text-sm text-spa-clay">{REFUND_REASON_LABEL[p.needsRefundReason] ?? p.needsRefundReason}</span>}
                    <span className="block text-xs text-spa-clay">{p.reference} · started {dateTime(p.createdAt)}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-spa-clay">Nothing here.</p>}
          <ErrorMessage>{error}</ErrorMessage>
          {rows.length < first.data!.total && (
            <div className="mt-3"><Button onClick={async () => {
              setError('');
              try {
                const page = await ops.payments(filter, PAGE, rows.length);
                setExtra((x) => [...x, ...page.rows]);
              } catch (err) {
                setError(messageFor(err));
              }
            }}>Show more</Button></div>
          )}
        </>
      )}
    </LoadState>
  );
}

function PaymentDetailScreen({ ops, id, role }: { ops: StaffOps; id: string; role: StaffRole }) {
  const detail = useLoad(() => ops.paymentDetail(id), [ops, id]);
  return (
    <div>
      <p className="mb-2 text-sm"><a className="underline underline-offset-2" href={href('payments')}>← Payments</a></p>
      <LoadState ready={!!detail.data} error={detail.error} onRetry={detail.reload}>
        {() => <Detail d={detail.data!} ops={ops} role={role} reload={detail.reload} />}
      </LoadState>
    </div>
  );
}

function Detail({ d, ops, role, reload }: { d: PaymentDetail; ops: StaffOps; role: StaffRole; reload: () => Promise<void> }) {
  const p = d.payment;
  return (
    <div>
      <PageTitle>Payment {p.reference}</PageTitle>
      <p className="-mt-4 mb-6 flex flex-wrap gap-2">
        <Badge>{PAYMENT_STATUS_LABEL[p.status] ?? p.status}</Badge>
        {p.needsRefund && p.refundableMinor > 0 && <Badge tone="bg-red-100 text-red-900">Refund needed</Badge>}
        <DemoBadge p={p} />
        {p.isTest && !p.isDemo && <Badge>Test mode</Badge>}
      </p>
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Panel title="Payment">
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-spa-clay">Amount</dt><dd>{money(p.amountMinor, p.currency)} ({p.kind === 'deposit' ? 'deposit' : 'full payment'})</dd>
            {p.bookingTotalMinor !== null && (<><dt className="text-spa-clay">Booking total</dt><dd>{money(p.bookingTotalMinor, p.currency)}</dd></>)}
            <dt className="text-spa-clay">Received</dt><dd>{p.paidMinor === null ? '—' : `${money(p.paidMinor, p.currency)}${p.paidAt ? `, ${dateTime(p.paidAt)}` : ''}`}</dd>
            <dt className="text-spa-clay">Refunded</dt><dd>{money(p.refundedMinor, p.currency)}{p.paidMinor !== null && ` (${money(p.refundableMinor, p.currency)} left)`}</dd>
            <dt className="text-spa-clay">Provider</dt><dd>{p.provider === 'mock' ? 'Demo provider' : p.provider}{p.channel && ` · ${p.channel}`}</dd>
            <dt className="text-spa-clay">Started</dt><dd>{dateTime(p.createdAt)}</dd>
            {p.failureReason && (<><dt className="text-spa-clay">Failure</dt><dd>{p.failureReason}</dd></>)}
            {p.needsRefundReason && (<><dt className="text-spa-clay">Why a refund</dt><dd>{REFUND_REASON_LABEL[p.needsRefundReason] ?? p.needsRefundReason}{p.needsRefundDetail && ` (${p.needsRefundDetail.replace(/_/g, ' ')})`}</dd></>)}
            <dt className="text-spa-clay">Refund status</dt><dd>{p.refundStatus.replace(/_/g, ' ')}{p.refundReference && ` · ${p.refundReference}`}</dd>
          </dl>
        </Panel>
        <Panel title="Booking and guest">
          {d.booking ? (
            <p className="text-sm mb-2">
              <a className="underline underline-offset-2" href={href('bookings', [d.booking.appointmentId])}>{d.booking.reference}</a>
              {' · '}{STATUS_LABEL[d.booking.status]} · {dateTime(d.booking.startsAt)} · {d.booking.serviceName} · {d.booking.therapistName}
            </p>
          ) : d.reservation ? (
            <p className="text-sm mb-2">No booking was made. Reservation ({d.reservation.status}) for {d.reservation.serviceName} with {d.reservation.therapistName}, {dateTime(d.reservation.startsAt)}.</p>
          ) : <p className="text-sm mb-2">No booking.</p>}
          {d.guest && (
            <p className="text-sm">
              <a className="underline underline-offset-2" href={href('customers', [d.guest.customerId])}>{d.guest.fullName}</a>
              {d.guest.email && ` · ${d.guest.email}`}{d.guest.phone && ` · ${d.guest.phone}`}
            </p>
          )}
        </Panel>
        <Panel title="Refunds recorded">
          {d.refunds.length ? (
            <ul className="space-y-2 text-sm">
              {d.refunds.map((r) => (
                <li key={r.id}>
                  {money(r.amountMinor, r.currency)} · {REFUND_METHOD_LABEL[r.method]}{r.reference && ` · ${r.reference}`}
                  <br /><span className="text-spa-clay">{dateTime(r.recordedAt)}{r.recordedByName && ` by ${r.recordedByName}`}{r.isDemo && ' · demo'}</span>
                  {r.note && <><br />{r.note}</>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-spa-clay">None.</p>}
        </Panel>
        {role === 'owner' ? (
          p.paidMinor !== null && p.refundableMinor > 0 && ['succeeded', 'partially_refunded'].includes(p.status)
            ? <RecordRefund key={p.updatedAt} ops={ops} p={p} reload={reload} />
            : null
        ) : (
          <Panel title="Record a refund"><p className="text-sm">Only the owner can record refunds.</p></Panel>
        )}
        <Panel title="Provider messages">
          {d.events.length ? (
            <ul className="space-y-1 text-sm">
              {d.events.map((e, i) => (
                <li key={i}>{e.eventType} · received {dateTime(e.receivedAt)}{e.processedAt ? ' · processed' : ' · not processed'}{e.processingError && ` · ${e.processingError}`}</li>
              ))}
            </ul>
          ) : <p className="text-sm text-spa-clay">None received.</p>}
        </Panel>
        <Panel title="History">
          <HistoryList entries={d.history} />
        </Panel>
      </div>
    </div>
  );
}

function RecordRefund({ ops, p, reload }: { ops: StaffOps; p: PaymentDetail['payment']; reload: () => Promise<void> }) {
  const [method, setMethod] = useState<RefundMethod>('bank_transfer');
  const [amount, setAmount] = useState(String(p.refundableMinor / 100));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  return (
    <Panel title="Record a refund">
      <p className="text-sm mb-3">
        Record a refund already made outside this app. Nothing is sent to the guest or the provider.
        {method === 'provider_dashboard'
          ? ' A refund made in the provider\'s dashboard is recorded as requested; the amounts change when the provider confirms it.'
          : ' The refunded amount is updated now.'}
      </p>
      <ChangeForm reasonLabel="Reason" submitLabel="Record refund" onSubmit={async (opts) => {
        const minor = Math.round(Number(amount.replace(/[,\s₦]/g, '')) * 100);
        await ops.recordRefund(p.id, Number.isFinite(minor) ? minor : 0, method, opts.reason ?? '', p.updatedAt, reference.trim() || null, note.trim() || null);
        await reload();
        return 'Refund recorded.';
      }}>
        <ChoiceGroup<RefundMethod> label="How was it refunded?" value={method} onChange={setMethod}
          options={(['bank_transfer', 'cash', 'provider_dashboard'] as RefundMethod[]).map((m) => ({ value: m, label: REFUND_METHOD_LABEL[m] }))} />
        <Field label="Amount (₦)" value={amount} onChange={setAmount} autoComplete="off" hint={`Up to ${money(p.refundableMinor, p.currency)}.`} />
        <Field label="Reference (optional)" value={reference} onChange={setReference} required={false} autoComplete="off" hint="For example the bank transfer or provider refund reference." />
        <Field label="Note (optional)" value={note} onChange={setNote} required={false} autoComplete="off" />
      </ChangeForm>
    </Panel>
  );
}
