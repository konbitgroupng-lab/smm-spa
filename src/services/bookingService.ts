import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireSupabase } from '../lib/supabase';

// Guest booking calls. Availability is read straight from the database
// function; holds go through the `booking` Edge Function, which is the only
// public way to reserve a slot. The server decides what is free: nothing here
// (or in the browser) is trusted to.

export interface Slot {
  startsAt: string;
  endsAt: string;
  /** Therapists free at this time, in display order. */
  therapistIds: string[];
}

export interface BookingHold {
  /** Secret reference to this guest's hold. Keep it in memory, not localStorage. */
  token: string;
  therapistId: string;
  startsAt: string;
  endsAt: string;
  expiresAt: string;
  hasCustomer: boolean;
}

export type BookingErrorCode =
  | 'slot_unavailable'
  | 'hold_expired'
  | 'service_unavailable'
  | 'therapist_unavailable'
  | 'dispatch_zone_required'
  | 'invalid_customer'
  | 'invalid_request'
  | 'rate_limited'
  | 'server_error'
  // Bank transfers
  | 'customer_required'
  | 'address_required'
  | 'nothing_to_pay'
  | 'transfer_too_late'
  | 'transfer_limit'
  | 'already_paid'
  | 'schedule_changed'
  | 'transfers_disabled'
  | 'transfer_not_found';

export class BookingError extends Error {
  constructor(public readonly code: BookingErrorCode, public readonly reason?: string) {
    super(code);
    this.name = 'BookingError';
  }
}

interface SlotRow {
  therapist_id: string;
  starts_at: string;
  ends_at: string;
}

/** Groups per-therapist rows into one entry per start time. */
export function groupSlots(rows: SlotRow[]): Slot[] {
  const byStart = new Map<string, Slot>();
  for (const row of rows) {
    const key = new Date(row.starts_at).toISOString();
    const slot = byStart.get(key) ?? { startsAt: key, endsAt: new Date(row.ends_at).toISOString(), therapistIds: [] };
    slot.therapistIds.push(row.therapist_id);
    byStart.set(key, slot);
  }
  return [...byStart.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * Free start times for a service on a calendar date (YYYY-MM-DD, business timezone).
 * Omit `therapistId` for "any available therapist".
 */
export async function getAvailableSlots(serviceId: string, date: string, therapistId?: string): Promise<Slot[]> {
  const { data, error } = await requireSupabase().rpc('get_available_slots', {
    p_service_id: serviceId,
    p_date: date,
    p_therapist_id: therapistId ?? null,
  });
  if (error) throw error;
  return groupSlots(data as SlotRow[]);
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke('booking', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      if (payload?.error) throw new BookingError(payload.error, payload.reason);
    }
    throw new BookingError('server_error');
  }
  return data as T;
}

export interface HoldRequest {
  serviceId: string;
  startsAt: string;
  therapistId?: string;
  locationType?: 'sanctuary' | 'mobile';
  dispatchZoneId?: string;
  /** Token of the guest's previous hold; it is released when the new one is created. */
  replaceHoldToken?: string;
}

/** Reserves a slot for the hold window (10 minutes). Throws BookingError('slot_unavailable') if it was just taken. */
export async function createHold(request: HoldRequest): Promise<BookingHold> {
  return (await invoke<{ hold: BookingHold }>({ action: 'create_hold', ...request })).hold;
}

export async function attachCustomer(
  holdToken: string,
  customer: { fullName: string; email: string; phone: string },
): Promise<BookingHold> {
  return (await invoke<{ hold: BookingHold }>({ action: 'attach_customer', holdToken, ...customer })).hold;
}

export async function releaseHold(holdToken: string): Promise<boolean> {
  return (await invoke<{ released: boolean }>({ action: 'release_hold', holdToken })).released;
}

/** A booking the guest is paying by direct bank transfer, as their page shows it. */
export interface TransferBooking {
  /** Secret: opens the guest's page. */
  token: string;
  reference: string;
  status: 'awaiting' | 'confirmed' | 'cancelled';
  /** Cancelled because the transfer was not confirmed in time. */
  expired: boolean;
  startsAt: string;
  endsAt: string;
  amountMinor: number;
  bookingTotalMinor: number;
  currency: string;
  /** The transfer must be confirmed by then, or the booking lapses. */
  dueAt: string;
  /** Shown only while the transfer is awaited. */
  bank: { name: string; accountNumber: string; accountName: string } | null;
}

/** Turns the guest's reservation into a booking awaiting their bank transfer. The server sets the amount. */
export async function requestTransfer(holdToken: string, extra: { serviceAddress?: string; notes?: string } = {}): Promise<TransferBooking> {
  return (await invoke<{ transfer: TransferBooking }>({ action: 'request_transfer', holdToken, ...extra })).transfer;
}

export async function getTransferBooking(token: string): Promise<TransferBooking> {
  return (await invoke<{ transfer: TransferBooking }>({ action: 'transfer_status', token })).transfer;
}
