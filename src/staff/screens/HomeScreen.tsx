import { formatDateLong } from '../../booking/dates';
import type { StaffOps } from '../lib/ops';
import { dateRange, localToday } from '../lib/time';
import { useLoad } from '../lib/useLoad';
import { href } from '../router';
import { LinkAsButton, LoadState, PageTitle, Panel } from '../ui';
import { AppointmentCard } from './common';
import { TransfersPanel } from './TransfersPanel';

/** Owner/admin home: today at a glance. */
export function HomeScreen({ ops }: { ops: StaffOps }) {
  const today = localToday();
  const dash = useLoad(() => ops.dashboard(), [ops]);
  const transfers = useLoad(() => ops.transfers(), [ops]);
  const list = useLoad(() => {
    const r = dateRange(today, today);
    return ops.appointments(r.from, r.to);
  }, [ops, today]);

  return (
    <div>
      <PageTitle actions={<LinkAsButton tone="primary" href={href('bookings', ['new'])}>New phone booking</LinkAsButton>}>
        Today
      </PageTitle>
      <p className="text-sm text-spa-clay -mt-4 mb-6">{formatDateLong(today)}</p>
      <LoadState ready={!!dash.data} error={dash.error} onRetry={dash.reload}>
        {() => {
          const d = dash.data!;
          const stats: [string, number, string?][] = [
            ['Bookings today', d.todayTotal],
            ['Still to come today', d.todayRemaining],
            ['Completed today', d.todayCompleted],
            ['No-shows today', d.todayNoShow],
            ['To collect at the venue today', d.todayToCollect],
            ['Finished, not yet marked', d.awaitingOutcome, 'Past appointments still shown as confirmed (last 7 days).'],
            ['Online payments flagged for refund', d.refundsFlagged, 'Refunds are handled by the owner; nothing is refunded automatically.'],
            ['Bookings in the next 7 days', d.next7Days],
            ['Bookings in conflict with the schedule', d.scheduleConflicts, 'Still booked; see Schedules › Conflicts.'],
            ['Payments waiting on the provider', d.paymentsWaiting, 'Reported pending more than 10 minutes ago; see Payments.'],
          ];
          return (
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
              {stats.map(([label, value, hint]) => (
                <div key={label} className="bg-white rounded-xl border border-spa-taupe p-4">
                  <dt className="text-sm text-spa-clay">{label}</dt>
                  <dd className="text-2xl font-medium">{value}</dd>
                  {hint && <dd className="text-xs text-spa-clay mt-1">{hint}</dd>}
                </div>
              ))}
            </dl>
          );
        }}
      </LoadState>
      {transfers.data && transfers.data.length > 0 && (
        <div className="mb-6">
          <TransfersPanel ops={ops} transfers={transfers.data} reload={async () => { await transfers.reload(); await list.reload(); }} />
        </div>
      )}
      <Panel title="Today's appointments">
        <LoadState ready={!!list.data} error={list.error} onRetry={list.reload}>
          {() =>
            list.data!.length ? (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {list.data!.map((a) => (
                  <li key={a.id}><AppointmentCard appt={a} /></li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-spa-clay">No appointments today.</p>
            )
          }
        </LoadState>
        <p className="mt-4 text-sm">
          <a className="underline underline-offset-2" href={href('bookings', [], { view: 'day', date: today })}>Day view by therapist</a>
        </p>
      </Panel>
    </div>
  );
}
