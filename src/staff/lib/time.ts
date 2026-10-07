import { addDays, DEFAULT_TIMEZONE, localToday } from '../../booking/dates';

// Dates in the staff app are business-timezone calendar dates (YYYY-MM-DD);
// the server is asked for instants. Helpers here convert between the two.

/** Minutes the zone is ahead of UTC at `instant`. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The instant of `time` (HH:MM) on local `date` in `timeZone`, as an ISO string. */
export function zonedInstant(date: string, time: string, timeZone: string = DEFAULT_TIMEZONE): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = offsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offset * 60_000).toISOString();
}

/** [start, end) of local dates `from` .. `to` inclusive, as instants. */
export function dateRange(from: string, to: string, timeZone: string = DEFAULT_TIMEZONE): { from: string; to: string } {
  return { from: zonedInstant(from, '00:00', timeZone), to: zonedInstant(addDays(to, 1), '00:00', timeZone) };
}

/** The Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((day + 6) % 7));
}

export function isDate(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

export { addDays, localToday };
