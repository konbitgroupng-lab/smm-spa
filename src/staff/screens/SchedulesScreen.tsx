import { useState } from 'react';
import { formatTime } from '../../booking/dates';
import { messageFor } from '../lib/backend';
import { DAY_NAMES, WEEK_ORDER } from '../lib/labels';
import type { ScheduleOverview, StaffOps, WeekPeriod } from '../lib/ops';
import { localToday, zonedInstant } from '../lib/time';
import { useLoad } from '../lib/useLoad';
import { href, type Route } from '../router';
import { Badge, Button, ErrorMessage, Field, LoadState, PageTitle, Panel, SelectField } from '../ui';
import { ChangeForm, reasonsText } from './ChangeForm';
import { dateTime } from './common';

const TABS = [
  { id: 'hours', label: 'Opening hours' },
  { id: 'therapists', label: 'Therapist weeks' },
  { id: 'time-off', label: 'Time off' },
  { id: 'blackouts', label: 'Closures' },
  { id: 'rules', label: 'Booking rules' },
  { id: 'conflicts', label: 'Conflicts' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/** Owner/admin: when the business is open and who works when. */
export function SchedulesScreen({ ops, route }: { ops: StaffOps; route: Route }) {
  const tab = (TABS.find((t) => t.id === route.params.get('tab'))?.id ?? 'hours') as Tab;
  const overview = useLoad(() => ops.scheduleOverview(), [ops]);
  return (
    <div>
      <PageTitle>Schedules</PageTitle>
      <nav aria-label="Schedule sections" className="mb-6">
        <ul className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <li key={t.id}>
              <a href={href('schedules', [], { tab: t.id })} aria-current={t.id === tab ? 'page' : undefined}
                className={`inline-block rounded-lg border px-3 py-2 text-sm ${t.id === tab ? 'border-spa-charcoal bg-spa-linen font-medium' : 'border-spa-taupe bg-white'}`}>
                {t.label}
                {t.id === 'conflicts' && overview.data && overview.data.conflictCount > 0 && (
                  <> <Badge tone="bg-amber-100 text-amber-900">{overview.data.conflictCount}</Badge></>
                )}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {tab === 'conflicts' ? (
        <ConflictsTab ops={ops} />
      ) : (
        <LoadState ready={!!overview.data} error={overview.error} onRetry={overview.reload}>
          {() => {
            const o = overview.data!;
            const reload = overview.reload;
            switch (tab) {
              case 'hours': return <HoursTab ops={ops} o={o} reload={reload} />;
              case 'therapists': return <TherapistWeeksTab ops={ops} o={o} reload={reload} selected={route.params.get('therapist')} />;
              case 'time-off': return <TimeOffTab ops={ops} o={o} reload={reload} />;
              case 'blackouts': return <BlackoutsTab ops={ops} o={o} reload={reload} />;
              default: return <RulesTab ops={ops} o={o} reload={reload} />;
            }
          }}
        </LoadState>
      )}
    </div>
  );
}

type TabProps = { ops: StaffOps; o: ScheduleOverview; reload: () => Promise<void> };

/** A time field with a short visible label ("Opens") and a full accessible name ("Monday opens"). */
function TimeInput({ label, short, value, onChange, disabled }: { label: string; short: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="block text-xs">
      <span className="block mb-1 text-spa-clay" aria-hidden="true">{short}</span>
      <input type="time" aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-spa-taupe px-2 py-1.5 text-base disabled:bg-spa-linen disabled:text-spa-clay w-full" />
    </label>
  );
}

function HoursTab({ ops, o, reload }: TabProps) {
  const [hours, setHours] = useState(o.hours);
  const set = (day: number, changes: Partial<ScheduleOverview['hours'][number]>) =>
    setHours((hs) => hs.map((h) => (h.dayOfWeek === day ? { ...h, ...changes } : h)));
  return (
    <Panel title="Opening hours">
      <p className="text-sm mb-4">Treatments must start and finish within these hours (the turnover buffer may run past closing).</p>
      <ChangeForm submitLabel="Save opening hours" onSubmit={async (opts) => {
        await ops.setBusinessHours(hours, o.hoursVersion, opts);
        await reload();
        return 'Opening hours saved.';
      }}>
        <ul className="space-y-3 mb-4">
          {WEEK_ORDER.map((day) => {
            const h = hours.find((x) => x.dayOfWeek === day) ?? { dayOfWeek: day, isClosed: true, opensAt: null, closesAt: null };
            return (
              <li key={day} className="grid grid-cols-[7rem_1fr] sm:grid-cols-[8rem_7rem_1fr_1fr] items-end gap-2">
                <span className="font-medium text-sm self-center">{DAY_NAMES[day]}</span>
                <label className="flex items-center gap-2 text-sm self-center">
                  <input type="checkbox" checked={!h.isClosed} className="h-4 w-4"
                    onChange={(e) => set(day, e.target.checked ? { isClosed: false, opensAt: h.opensAt ?? '09:00', closesAt: h.closesAt ?? '21:00' } : { isClosed: true })} />
                  Open
                </label>
                <div className="col-span-2 sm:col-span-1"><TimeInput label={`${DAY_NAMES[day]} opens`} short="Opens" value={h.opensAt ?? ''} disabled={h.isClosed} onChange={(v) => set(day, { opensAt: v })} /></div>
                <div className="col-span-2 sm:col-span-1"><TimeInput label={`${DAY_NAMES[day]} closes`} short="Closes" value={h.closesAt ?? ''} disabled={h.isClosed} onChange={(v) => set(day, { closesAt: v })} /></div>
              </li>
            );
          })}
        </ul>
      </ChangeForm>
    </Panel>
  );
}

/** One shift and at most one break per day, as the spa plans. */
interface DayPlan { works: boolean; start: string; end: string; hasBreak: boolean; breakStart: string; breakEnd: string }

function planOf(shifts: WeekPeriod[], breaks: WeekPeriod[]): Record<number, DayPlan> {
  return Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => {
    const s = shifts.find((x) => x.dayOfWeek === d);
    const b = breaks.find((x) => x.dayOfWeek === d);
    return [d, { works: !!s, start: s?.startTime ?? '09:00', end: s?.endTime ?? '20:00', hasBreak: !!b, breakStart: b?.startTime ?? '13:00', breakEnd: b?.endTime ?? '14:00' }];
  }));
}

function TherapistWeeksTab({ ops, o, reload, selected }: TabProps & { selected: string | null }) {
  const therapist = o.therapists.find((t) => t.id === selected) ?? o.therapists[0];
  if (!therapist) return <p className="text-sm text-spa-clay">No therapists yet.</p>;
  return (
    <div>
      <div className="max-w-sm">
        <SelectField label="Therapist" value={therapist.id} onChange={(v) => { window.location.hash = href('schedules', [], { tab: 'therapists', therapist: v }); }}
          options={o.therapists.map((t) => ({ value: t.id, label: `${t.name}${t.isActive ? '' : ' (inactive)'}` }))} />
      </div>
      <TherapistWeek key={therapist.id} ops={ops} therapist={therapist} reload={reload} />
    </div>
  );
}

function TherapistWeek({ ops, therapist, reload }: { ops: StaffOps; therapist: ScheduleOverview['therapists'][number]; reload: () => Promise<void> }) {
  const [plan, setPlan] = useState(() => planOf(therapist.shifts, therapist.breaks));
  const multiple = [0, 1, 2, 3, 4, 5, 6].some((d) =>
    therapist.shifts.filter((s) => s.dayOfWeek === d).length > 1 || therapist.breaks.filter((b) => b.dayOfWeek === d).length > 1);
  const set = (day: number, changes: Partial<DayPlan>) => setPlan((p) => ({ ...p, [day]: { ...p[day], ...changes } }));
  return (
    <Panel title={`${therapist.name}: weekly hours`}>
      {multiple && <ErrorMessage>This therapist has more than one shift or break on some days. Saving here keeps one of each per day.</ErrorMessage>}
      <ChangeForm submitLabel="Save weekly hours" onSubmit={async (opts) => {
        const shifts: WeekPeriod[] = [];
        const breaks: WeekPeriod[] = [];
        for (const d of WEEK_ORDER) {
          const p = plan[d];
          if (!p.works) continue;
          shifts.push({ dayOfWeek: d, startTime: p.start, endTime: p.end });
          if (p.hasBreak) breaks.push({ dayOfWeek: d, startTime: p.breakStart, endTime: p.breakEnd });
        }
        await ops.setTherapistWeek(therapist.id, shifts, breaks, therapist.weekVersion, opts);
        await reload();
        return 'Weekly hours saved.';
      }}>
        <ul className="space-y-4 mb-4">
          {WEEK_ORDER.map((d) => {
            const p = plan[d];
            return (
              <li key={d} className="border-b border-spa-taupe pb-3">
                <div className="flex flex-wrap items-center gap-4 mb-2">
                  <span className="font-medium text-sm w-24">{DAY_NAMES[d]}</span>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={p.works} onChange={(e) => set(d, { works: e.target.checked })} />Works</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={p.works && p.hasBreak} disabled={!p.works} onChange={(e) => set(d, { hasBreak: e.target.checked })} />Break</label>
                </div>
                {p.works && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <TimeInput label={`${DAY_NAMES[d]} starts`} short="Starts" value={p.start} onChange={(v) => set(d, { start: v })} />
                    <TimeInput label={`${DAY_NAMES[d]} ends`} short="Ends" value={p.end} onChange={(v) => set(d, { end: v })} />
                    {p.hasBreak && <TimeInput label={`${DAY_NAMES[d]} break starts`} short="Break from" value={p.breakStart} onChange={(v) => set(d, { breakStart: v })} />}
                    {p.hasBreak && <TimeInput label={`${DAY_NAMES[d]} break ends`} short="Break until" value={p.breakEnd} onChange={(v) => set(d, { breakEnd: v })} />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </ChangeForm>
    </Panel>
  );
}

function PeriodFields({ from, to, setFrom, setTo }: {
  from: { date: string; time: string }; to: { date: string; time: string };
  setFrom: (v: { date: string; time: string }) => void; setTo: (v: { date: string; time: string }) => void;
}) {
  return (
    <div className="grid gap-x-3 sm:grid-cols-4">
      <Field label="From date" type="date" value={from.date} onChange={(v) => setFrom({ ...from, date: v })} />
      <Field label="From time" type="time" value={from.time} onChange={(v) => setFrom({ ...from, time: v })} />
      <Field label="Until date" type="date" value={to.date} onChange={(v) => setTo({ ...to, date: v })} />
      <Field label="Until time" type="time" value={to.time} onChange={(v) => setTo({ ...to, time: v })} />
    </div>
  );
}

function RemoveButton({ label, onRemove, after }: { label: string; onRemove: () => Promise<void>; after: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <span>
      <Button busy={busy} onClick={async () => {
        setBusy(true);
        setError('');
        try {
          await onRemove();
          await after();
        } catch (err) {
          setError(messageFor(err));
          setBusy(false);
        }
      }}>{label}</Button>
      <ErrorMessage>{error}</ErrorMessage>
    </span>
  );
}

function TimeOffTab({ ops, o, reload }: TabProps) {
  const today = localToday();
  const [therapistId, setTherapistId] = useState(o.therapists[0]?.id ?? '');
  const [from, setFrom] = useState({ date: today, time: '00:00' });
  const [to, setTo] = useState({ date: today, time: '23:59' });
  const [note, setNote] = useState('');
  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <Panel title="Add time off">
        <ChangeForm submitLabel="Add time off" onSubmit={async (opts) => {
          await ops.addTimeOff(therapistId, zonedInstant(from.date, from.time), zonedInstant(to.date, to.time), note.trim() || null, opts);
          setNote('');
          await reload();
          return 'Time off added.';
        }}>
          <SelectField label="Therapist" value={therapistId} onChange={setTherapistId} options={o.therapists.map((t) => ({ value: t.id, label: t.name }))} />
          <PeriodFields from={from} to={to} setFrom={setFrom} setTo={setTo} />
          <Field label="Note (optional)" value={note} onChange={setNote} required={false} hint="Visible to owner and admin only." />
        </ChangeForm>
      </Panel>
      <Panel title="Upcoming time off">
        {o.timeOff.length ? (
          <ul className="space-y-3">
            {o.timeOff.map((t) => (
              <li key={t.id} className="text-sm flex flex-wrap items-center justify-between gap-2 border-b border-spa-taupe pb-2">
                <span><strong>{t.therapistName}</strong><br />{dateTime(t.startsAt)} – {dateTime(t.endsAt)}{t.note && <><br /><span className="text-spa-clay">{t.note}</span></>}</span>
                <RemoveButton label="Remove" onRemove={() => ops.removeTimeOff(t.id, null)} after={reload} />
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-spa-clay">None planned.</p>}
      </Panel>
    </div>
  );
}

function BlackoutsTab({ ops, o, reload }: TabProps) {
  const today = localToday();
  const [from, setFrom] = useState({ date: today, time: '00:00' });
  const [to, setTo] = useState({ date: today, time: '23:59' });
  const [note, setNote] = useState('');
  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <Panel title="Close the business">
        <p className="text-sm mb-3">No treatments can be booked during a closure, for any therapist.</p>
        <ChangeForm submitLabel="Add closure" onSubmit={async (opts) => {
          await ops.addBlackout(zonedInstant(from.date, from.time), zonedInstant(to.date, to.time), note.trim() || null, opts);
          setNote('');
          await reload();
          return 'Closure added.';
        }}>
          <PeriodFields from={from} to={to} setFrom={setFrom} setTo={setTo} />
          <Field label="Note (optional)" value={note} onChange={setNote} required={false} hint="For example: public holiday." />
        </ChangeForm>
      </Panel>
      <Panel title="Upcoming closures">
        {o.blackouts.length ? (
          <ul className="space-y-3">
            {o.blackouts.map((b) => (
              <li key={b.id} className="text-sm flex flex-wrap items-center justify-between gap-2 border-b border-spa-taupe pb-2">
                <span>{dateTime(b.startsAt)} – {dateTime(b.endsAt)}{b.note && <><br /><span className="text-spa-clay">{b.note}</span></>}</span>
                <RemoveButton label="Remove" onRemove={() => ops.removeBlackout(b.id, null)} after={reload} />
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-spa-clay">None planned.</p>}
      </Panel>
    </div>
  );
}

function NumberField({ label, value, onChange, hint, min, max }: { label: string; value: number; onChange: (v: number) => void; hint?: string; min: number; max: number }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium mb-1">
        {label}
        <input type="number" min={min} max={max} value={Number.isFinite(value) ? value : ''} required
          onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
          className="mt-1 block w-full rounded-lg border border-spa-taupe px-3 py-2 text-base font-normal" />
      </label>
      {hint && <p className="text-xs text-spa-clay">{hint}</p>}
    </div>
  );
}

function RulesTab({ ops, o, reload }: TabProps) {
  const r = o.rules;
  const [rules, setRules] = useState({
    holdMinutes: r.holdMinutes, minLeadHours: r.minLeadMinutes / 60, maxAdvanceDays: r.maxAdvanceDays,
    slotIntervalMinutes: r.slotIntervalMinutes, defaultBufferMinutes: r.defaultBufferMinutes,
  });
  const set = (k: keyof typeof rules) => (v: number) => setRules((x) => ({ ...x, [k]: v }));
  return (
    <Panel title="Booking rules">
      <p className="text-sm mb-4">These apply to new bookings, online and by phone, from the moment they are saved. Existing bookings are not affected. Times are in {r.timezone}.</p>
      <ChangeForm reasonLabel="Reason" submitLabel="Save booking rules" onSubmit={async (opts) => {
        await ops.updateBookingRules(r.updatedAt, {
          holdMinutes: rules.holdMinutes, minLeadMinutes: Math.round(rules.minLeadHours * 60), maxAdvanceDays: rules.maxAdvanceDays,
          slotIntervalMinutes: rules.slotIntervalMinutes, defaultBufferMinutes: rules.defaultBufferMinutes,
        }, opts.reason ?? '');
        await reload();
        return 'Booking rules saved.';
      }}>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <NumberField label="Minimum notice (hours)" value={rules.minLeadHours} onChange={set('minLeadHours')} min={0} max={720} hint="How soon before a treatment it can still be booked." />
          <NumberField label="Booking window (days)" value={rules.maxAdvanceDays} onChange={set('maxAdvanceDays')} min={1} max={365} hint="How far ahead bookings are taken." />
          <NumberField label="Booking grid (minutes)" value={rules.slotIntervalMinutes} onChange={set('slotIntervalMinutes')} min={5} max={240} hint="Start times are offered every this many minutes from midnight." />
          <NumberField label="Reservation hold (minutes)" value={rules.holdMinutes} onChange={set('holdMinutes')} min={1} max={60} hint="How long a guest's chosen time is kept while they enter their details." />
          <NumberField label="Default turnover buffer (minutes)" value={rules.defaultBufferMinutes} onChange={set('defaultBufferMinutes')} min={0} max={240} hint="Each treatment has its own buffer; this is the default for new ones." />
        </div>
      </ChangeForm>
    </Panel>
  );
}

function ConflictsTab({ ops }: { ops: StaffOps }) {
  const list = useLoad(() => ops.scheduleConflicts(), [ops]);
  return (
    <Panel title="Bookings in conflict with the schedule or catalogue">
      <p className="text-sm mb-4">
        These future bookings stay booked. The schedule or catalogue changed after they were made; contact the guest, reschedule,
        or change the schedule back. A booking leaves this list once nothing conflicts with it.
      </p>
      <LoadState ready={!!list.data} error={list.error} onRetry={list.reload}>
        {() => list.data!.length ? (
          <ul className="space-y-2">
            {list.data!.map((c) => (
              <li key={c.id} className="text-sm border-b border-spa-taupe pb-2">
                <a className="underline underline-offset-2 font-medium" href={href('bookings', [c.id])}>
                  {dateTime(c.startsAt)}–{formatTime(c.endsAt)} · {c.reference}
                </a>
                {' · '}{c.serviceName} · {c.therapistName}{c.contactName && ` · ${c.contactName}`}{c.locationType === 'mobile' && ` · In-home${c.zoneName ? ` (${c.zoneName})` : ''}`}
                <br /><span className="text-amber-900">{reasonsText(c.reasons)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-spa-clay">No conflicts.</p>}
      </LoadState>
      <p className="text-xs text-spa-clay mt-3">Bookings moved with a rule override also appear here.</p>
    </Panel>
  );
}

