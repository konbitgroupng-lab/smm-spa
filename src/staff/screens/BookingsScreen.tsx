import { formatDateLong, formatDateShort, localDateOf } from '../../booking/dates';
import type { AppointmentRow, StaffOps } from '../lib/ops';
import { addDays, dateRange, isDate, localToday, weekStart } from '../lib/time';
import { useLoad } from '../lib/useLoad';
import { href, navigate, type Route } from '../router';
import { LinkAsButton, LoadState, PageTitle, SelectField } from '../ui';
import { AppointmentCard } from './common';

type View = 'list' | 'day' | 'week';
const VIEWS: { id: View; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'day', label: 'Day by therapist' },
  { id: 'week', label: 'Week' },
];
const STATUS_FILTERS = [
  { value: 'active', label: 'Booked and finished' },
  { value: 'confirmed', label: 'Confirmed only' },
  { value: 'cancelled', label: 'Cancelled only' },
  { value: 'all', label: 'Everything' },
];

function keep(a: AppointmentRow, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return a.status !== 'cancelled';
  return a.status === filter;
}

/** Owner/admin: appointments as a list, a day by therapist, or a week. */
export function BookingsScreen({ ops, route }: { ops: StaffOps; route: Route }) {
  const view = (VIEWS.find((v) => v.id === route.params.get('view'))?.id ?? 'list') as View;
  const date = isDate(route.params.get('date')) ? route.params.get('date')! : localToday();
  const therapist = route.params.get('therapist') ?? '';
  const status = route.params.get('status') ?? 'active';
  const go = (changes: Record<string, string | null>) =>
    navigate(href('bookings', [], { view, date, therapist: therapist || null, status: status === 'active' ? null : status, ...changes }));

  const [from, to] = view === 'day' ? [date, date] : view === 'week' ? [weekStart(date), addDays(weekStart(date), 6)] : [date, addDays(date, 6)];
  const step = view === 'day' ? 1 : 7;
  const options = useLoad(() => ops.bookingOptions(), [ops]);
  const list = useLoad(() => {
    const r = dateRange(from, to);
    return ops.appointments(r.from, r.to, view === 'day' ? null : therapist || null);
  }, [ops, from, to, therapist, view]);
  const shown = (list.data ?? []).filter((a) => keep(a, status));

  return (
    <div>
      <PageTitle actions={<LinkAsButton tone="primary" href={href('bookings', ['new'])}>New phone booking</LinkAsButton>}>Bookings</PageTitle>

      <nav aria-label="Booking views" className="mb-4">
        <ul className="flex flex-wrap gap-2">
          {VIEWS.map((v) => (
            <li key={v.id}>
              <a href={href('bookings', [], { view: v.id, date })} aria-current={v.id === view ? 'page' : undefined}
                className={`inline-block rounded-lg border px-3 py-2 text-sm ${v.id === view ? 'border-spa-charcoal bg-spa-linen font-medium' : 'border-spa-taupe bg-white'}`}>
                {v.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="flex gap-2 mb-4">
          <button type="button" onClick={() => go({ date: addDays(date, -step) })} className="rounded-lg border border-spa-taupe bg-white px-3 py-2 text-sm min-h-[40px]">
            {view === 'day' ? 'Previous day' : 'Previous week'}
          </button>
          <button type="button" onClick={() => go({ date: localToday() })} className="rounded-lg border border-spa-taupe bg-white px-3 py-2 text-sm min-h-[40px]">Today</button>
          <button type="button" onClick={() => go({ date: addDays(date, step) })} className="rounded-lg border border-spa-taupe bg-white px-3 py-2 text-sm min-h-[40px]">
            {view === 'day' ? 'Next day' : 'Next week'}
          </button>
        </div>
        <div className="mb-4">
          <label htmlFor="bookings-date" className="block text-sm font-medium mb-1">Date</label>
          <input id="bookings-date" type="date" value={date} onChange={(e) => isDate(e.target.value) && go({ date: e.target.value })}
            className="rounded-lg border border-spa-taupe px-3 py-2 text-base" />
        </div>
        {view !== 'day' && (
          <div className="min-w-[12rem]">
            <SelectField label="Therapist" value={therapist} required={false} onChange={(v) => go({ therapist: v || null })}
              options={[{ value: '', label: 'All therapists' }, ...(options.data?.therapists ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
          </div>
        )}
        <div className="min-w-[12rem]">
          <SelectField label="Show" value={status} onChange={(v) => go({ status: v === 'active' ? null : v })} options={STATUS_FILTERS} />
        </div>
      </div>

      <h2 className="font-medium mb-3" aria-live="polite">
        {from === to ? formatDateLong(from) : `${formatDateShort(from)} – ${formatDateShort(to)}`}
        {list.data && ` · ${shown.length} ${shown.length === 1 ? 'appointment' : 'appointments'}`}
      </h2>

      <LoadState ready={!!list.data && (view !== 'day' || !!options.data)} error={list.error || options.error} onRetry={() => { void list.reload(); void options.reload(); }}>
        {() => {
          if (view === 'day') {
            const therapists = options.data!.therapists;
            const extra = [...new Set(shown.map((a) => a.therapistId))].filter((id) => !therapists.some((t) => t.id === id));
            const columns = [
              ...therapists.map((t) => ({ id: t.id, name: t.name })),
              ...extra.map((id) => ({ id, name: shown.find((a) => a.therapistId === id)!.therapistName })),
            ];
            return (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {columns.map((col) => {
                  const items = shown.filter((a) => a.therapistId === col.id);
                  return (
                    <section key={col.id} aria-label={col.name} className="min-w-0">
                      <h3 className="font-medium text-sm mb-2">{col.name}</h3>
                      {items.length ? (
                        <ul className="space-y-2">{items.map((a) => <li key={a.id}><AppointmentCard appt={a} showTherapist={false} /></li>)}</ul>
                      ) : (
                        <p className="text-sm text-spa-clay">Nothing booked.</p>
                      )}
                    </section>
                  );
                })}
              </div>
            );
          }
          const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
          if (view === 'week') {
            return (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                {days.map((day) => {
                  const items = shown.filter((a) => localDateOf(a.startsAt) === day);
                  return (
                    <section key={day} aria-label={formatDateLong(day)} className="min-w-0">
                      <h3 className="font-medium text-sm mb-2">
                        <a className="underline-offset-2 hover:underline" href={href('bookings', [], { view: 'day', date: day })}>{formatDateShort(day)}</a>
                      </h3>
                      {items.length ? (
                        <ul className="space-y-2">{items.map((a) => <li key={a.id}><AppointmentCard appt={a} /></li>)}</ul>
                      ) : (
                        <p className="text-sm text-spa-clay">—</p>
                      )}
                    </section>
                  );
                })}
              </div>
            );
          }
          if (!shown.length) return <p className="text-sm text-spa-clay">No appointments in this period.</p>;
          return (
            <div className="space-y-6">
              {days.filter((day) => shown.some((a) => localDateOf(a.startsAt) === day)).map((day) => (
                <section key={day} aria-label={formatDateLong(day)}>
                  <h3 className="font-medium text-sm mb-2">{formatDateLong(day)}</h3>
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {shown.filter((a) => localDateOf(a.startsAt) === day).map((a) => <li key={a.id}><AppointmentCard appt={a} /></li>)}
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
