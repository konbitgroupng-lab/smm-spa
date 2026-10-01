// Date helpers for tests. The seeded business timezone is Africa/Lagos (UTC+1, no DST).

const DAY = 24 * 60 * 60 * 1000;
const LAGOS_OFFSET = '+01:00';

/**
 * A future local calendar date (YYYY-MM-DD) falling on `dow` (0 = Sunday),
 * at least a week out, plus `weeksAhead` further weeks.
 */
export function upcoming(dow: number, weeksAhead = 0): string {
  const lagosNow = new Date(Date.now() + 60 * 60 * 1000);
  const base = new Date(Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate()) + 7 * DAY);
  const shift = (dow - base.getUTCDay() + 7) % 7;
  return new Date(base.getTime() + (shift + 7 * weeksAhead) * DAY).toISOString().slice(0, 10);
}

/** The instant of `time` (HH:MM) on local date `date`. */
export function at(date: string, time: string): Date {
  return new Date(`${date}T${time}:00${LAGOS_OFFSET}`);
}

/** HH:MM in Lagos for an instant. */
export function localTime(instant: string | Date): string {
  return new Date(new Date(instant).getTime() + 60 * 60 * 1000).toISOString().slice(11, 16);
}

export const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6, SUN = 0;
