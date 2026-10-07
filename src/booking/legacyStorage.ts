// The old in-page booking form kept bookings, with names, emails and phone
// numbers, in the browser's localStorage under this key. Online booking no
// longer stores anything there, and copies left behind are removed.

export const LEGACY_BOOKINGS_KEY = 'everest_bookings';

export function clearLegacyBookingStorage(): void {
  try {
    window.localStorage.removeItem(LEGACY_BOOKINGS_KEY);
  } catch {
    // Storage unavailable (private browsing, blocked): nothing was stored either.
  }
}
