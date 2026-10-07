import { describe, expect, it } from 'vitest';
import { addDays, bookableDates, formatDateLong, formatDateShort, formatTime, localDateOf, localToday, remaining } from '../../src/booking/dates';

describe('booking calendar in the business timezone', () => {
  it('uses Lagos time, not the device clock, to decide what "today" is', () => {
    // 23:30 UTC on 11 Oct is already 00:30 on 12 Oct in Lagos (UTC+1).
    const lateUtc = new Date('2026-10-11T23:30:00Z');
    expect(localToday('Africa/Lagos', lateUtc)).toBe('2026-10-12');
    expect(localToday('UTC', lateUtc)).toBe('2026-10-11');
    expect(localDateOf('2026-10-11T23:30:00Z')).toBe('2026-10-12');
  });

  it('offers today through the booking window, inclusive', () => {
    const now = new Date('2026-10-12T10:00:00+01:00');
    const dates = bookableDates(60, 'Africa/Lagos', now);
    expect(dates).toHaveLength(61);
    expect(dates[0]).toBe('2026-10-12');
    expect(dates.at(-1)).toBe('2026-12-11');
    expect(bookableDates(0, 'Africa/Lagos', now)).toEqual(['2026-10-12']);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('formats times and dates as the guest should read them', () => {
    expect(formatTime('2026-10-12T08:00:00Z')).toBe('09:00');
    expect(formatDateShort('2026-10-12')).toBe('Mon 12 Oct');
    expect(formatDateLong('2026-10-12')).toBe('Monday 12 October 2026');
  });

  it('counts down the time a slot is held', () => {
    const now = Date.parse('2026-10-12T09:00:00Z');
    expect(remaining('2026-10-12T09:09:05Z', now)).toEqual({ totalSeconds: 545, label: '9:05' });
    expect(remaining('2026-10-12T08:59:00Z', now)).toEqual({ totalSeconds: 0, label: '0:00' });
  });
});
