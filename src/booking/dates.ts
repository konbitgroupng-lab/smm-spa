// Calendar helpers for the booking funnel. Every date and time a guest sees is
// in the business timezone (Africa/Lagos by default), whatever the device's own
// timezone is. Dates are plain YYYY-MM-DD strings.

export const DEFAULT_TIMEZONE = 'Africa/Lagos';

/** Today's date in `timeZone`. */
export function localToday(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** `date` plus `days` calendar days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The dates a guest may pick: today through today + maxAdvanceDays, in the
 * business timezone. Whether any time on a date is actually free (opening
 * hours, notice period, shifts...) is decided by the server.
 */
export function bookableDates(maxAdvanceDays: number, timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string[] {
  const today = localToday(timeZone, now);
  const days = Math.max(0, Math.floor(maxAdvanceDays));
  return Array.from({ length: days + 1 }, (_, i) => addDays(today, i));
}

/** The calendar date of an instant, in `timeZone`. */
export function localDateOf(instant: string | Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return localToday(timeZone, new Date(instant));
}

/** "10:30" */
export function formatTime(instant: string | Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(instant));
}

// Built from parts so the result is the same on every browser (ICU versions
// disagree on punctuation such as a comma after the weekday).
function dateLabel(date: string, style: 'short' | 'long'): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: style,
    day: 'numeric',
    month: style,
    ...(style === 'long' ? { year: 'numeric' as const } : {}),
  }).formatToParts(new Date(`${date}T12:00:00Z`));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return [part('weekday'), part('day'), part('month'), style === 'long' ? part('year') : ''].filter(Boolean).join(' ');
}

/** "Mon 12 Oct" for a YYYY-MM-DD date. */
export function formatDateShort(date: string): string {
  return dateLabel(date, 'short');
}

/** "Monday 12 October 2026" for a YYYY-MM-DD date. */
export function formatDateLong(date: string): string {
  return dateLabel(date, 'long');
}

/** Minutes and seconds left until `expiresAt`, never negative. */
export function remaining(expiresAt: string, now: number = Date.now()): { totalSeconds: number; label: string } {
  const totalSeconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  return { totalSeconds, label: `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}` };
}
