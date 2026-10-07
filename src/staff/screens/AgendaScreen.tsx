import { useState } from 'react';
import { formatDateLong, formatDateShort, localDateOf } from '../../booking/dates';
import { messageFor } from '../lib/backend';
import { SOURCE_LABEL, STATUS_LABEL, STATUS_TONE } from '../lib/labels';
import type { AgendaItem, StaffOps } from '../lib/ops';
import { addDays, dateRange, isDate, localToday, weekStart } from '../lib/time';
import { useLoad } from '../lib/useLoad';
import { href, navigate, type Route } from '../router';
import { Badge, Button, ErrorMessage, LoadState, Notice, PageTitle } from '../ui';
import { timeRange } from './common';

const PAYMENT_WORDS = {
  paid: 'Paid',
  deposit_paid: 'Deposit paid: collect the balance',
  to_collect: 'Collect payment',
} as const;

/** Therapist: their own appointments, with what they need for each visit. */
export function AgendaScreen({ ops, route }: { ops: StaffOps; route: Route }) {
  const view = route.params.get('view') === 'week' ? 'week' : 'day';
  const date = isDate(route.params.get('date')) ? route.params.get('date')! : localToday();
  const [from, to] = view === 'day' ? [date, date] : [weekStart(date), addDays(weekStart(date), 6)];
  const step = view === 'day' ? 1 : 7;
  const go = (changes: Record<string, string>) => navigate(href('agenda', [], { view, date, ...changes }));
  const [notice, setNotice] = useState('');
  const agenda = useLoad(() => {
    const r = dateRange(from, to);
    return ops.agenda(r.from, r.to);
  }, [ops, from, to]);

  return (
    <div>
      <PageTitle>My agenda</PageTitle>
      <Notice>{notice}</Notice>
      <div className="flex flex-wrap gap-2 mb-4">
        {(['day', 'week'] as const).map((v) => (
          <a key={v} href={href('agenda', [], { view: v, date })} aria-current={v === view ? 'page' : undefined}
            className={`rounded-lg border px-3 py-2 text-sm ${v === view ? 'border-spa-charcoal bg-spa-linen font-medium' : 'border-spa-taupe bg-white'}`}>
            {v === 'day' ? 'Day' : 'Week'}
          </a>
        ))}
        <Button onClick={() => go({ date: addDays(date, -step) })}>{view === 'day' ? 'Previous day' : 'Previous week'}</Button>
        <Button onClick={() => go({ date: localToday() })}>Today</Button>
        <Button onClick={() => go({ date: addDays(date, step) })}>{view === 'day' ? 'Next day' : 'Next week'}</Button>
      </div>
      <h2 className="font-medium mb-3" aria-live="polite">{from === to ? formatDateLong(from) : `${formatDateShort(from)} – ${formatDateShort(to)}`}</h2>
      <LoadState ready={!!agenda.data} error={agenda.error} onRetry={agenda.reload}>
        {() => {
          const items = agenda.data!;
          if (!items.length) return <p className="text-sm text-spa-clay">No appointments.</p>;
          const days = [...new Set(items.map((i) => localDateOf(i.startsAt)))];
          return (
            <div className="space-y-6">
              {days.map((day) => (
                <section key={day} aria-label={formatDateLong(day)}>
                  {view === 'week' && <h3 className="font-medium text-sm mb-2">{formatDateLong(day)}</h3>}
                  <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {items.filter((i) => localDateOf(i.startsAt) === day).map((item) => (
                      <li key={`${item.id}-${item.updatedAt}`}><AgendaCard item={item} ops={ops} onDone={async (m) => { await agenda.reload(); setNotice(m); }} /></li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          );
        }}
      </LoadState>
    </div>
  );
}

function AgendaCard({ item, ops, onDone }: { item: AgendaItem; ops: StaffOps; onDone: (message: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const started = new Date(item.startsAt).getTime() <= Date.now();

  async function mark(status: 'completed' | 'no_show') {
    setBusy(true);
    setError('');
    try {
      await ops.setStatus(item.id, status, item.updatedAt);
      await onDone(status === 'completed' ? 'Marked completed.' : 'Marked as a no-show.');
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  }

  return (
    <article aria-label={`${timeRange(item.startsAt, item.endsAt)} ${item.serviceName}`} className="bg-white rounded-xl border border-spa-taupe p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{timeRange(item.startsAt, item.endsAt)}</p>
        <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
      </div>
      <p className="text-sm">{item.serviceName} · {item.durationMinutes} min</p>
      <p className="text-sm">{item.locationType === 'mobile' ? `In-home · ${item.zoneName ?? ''}` : 'At the spa'}</p>
      {item.serviceAddress && <p className="text-sm whitespace-pre-line">{item.serviceAddress}</p>}
      <p className="text-sm mt-2">
        {item.contactName}
        {item.contactPhone && <> · <a className="underline underline-offset-2" href={`tel:${item.contactPhone.replace(/[^+\d]/g, '')}`}>{item.contactPhone}</a></>}
      </p>
      {item.customerNotes && <p className="text-sm mt-2"><span className="font-medium">Guest's notes:</span> {item.customerNotes}</p>}
      {item.bookingNotes && <p className="text-sm mt-1"><span className="font-medium">Notes:</span> {item.bookingNotes}</p>}
      <p className="mt-2 flex flex-wrap gap-1">
        <Badge>{PAYMENT_WORDS[item.paymentState]}</Badge>
        {item.source !== 'online' && <Badge>{SOURCE_LABEL[item.source]}</Badge>}
        {item.isDemo && <Badge tone="bg-amber-100 text-amber-900">Demo</Badge>}
      </p>
      <ErrorMessage>{error}</ErrorMessage>
      {item.status === 'confirmed' && started && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button tone="primary" busy={busy} onClick={() => void mark('completed')}>Completed</Button>
          <Button busy={busy} onClick={() => void mark('no_show')}>No-show</Button>
        </div>
      )}
    </article>
  );
}
