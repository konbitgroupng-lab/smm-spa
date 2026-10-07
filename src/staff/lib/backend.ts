import type { AuthError, SupabaseClient } from '@supabase/supabase-js';

// Everything the staff app asks of the server. The app never decides what a
// user may do: the database answers that (RLS and the staff functions). The
// app only reflects the answer, so a bug here cannot grant access.

export type StaffRole = 'owner' | 'admin' | 'therapist';
export type AuthLevel = 'aal1' | 'aal2';

export interface StaffProfile {
  id: string;
  fullName: string;
  phone: string | null;
  role: StaffRole;
  isActive: boolean;
  /** Version of the profile, sent back unchanged with an edit (never via Date: it would lose microseconds). */
  updatedAt: string;
}

/** The server's view of the signed-in user (staff_whoami). */
export interface WhoAmI {
  userId: string;
  profile: StaffProfile | null;
  /** The role the database will honour for this session; null means no staff access. */
  effectiveRole: StaffRole | null;
  therapistId: string | null;
  sessionAal: AuthLevel;
  requiredAal: AuthLevel | null;
}

export interface StaffSession {
  email: string | null;
}

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'PASSWORD_RECOVERY' | 'OTHER';

export interface StaffBackend {
  getSession(): Promise<StaffSession | null>;
  /** Returns an unsubscribe function. */
  onAuthChange(callback: (event: AuthEvent) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
  whoami(): Promise<WhoAmI>;
  updateOwnProfile(fullName: string, phone: string | null, expectedUpdatedAt: string): Promise<void>;
}

/** Errors the staff app knows how to explain; anything else is 'unknown'. */
export class StaffError extends Error {
  /** `detail` names the rule behind schedule_rule / slot_unavailable, when the server gives one. */
  constructor(public code: string, public detail?: string) {
    super(code);
  }
}

export type Access =
  | { kind: 'signed_out' }
  | { kind: 'set_password'; link: 'recovery' | 'invite' }
  | { kind: 'inactive'; who: WhoAmI }
  | { kind: 'mfa_required'; who: WhoAmI }
  | { kind: 'ready'; who: WhoAmI; role: StaffRole };

/**
 * What to show a signed-in user. A stronger sign-in requirement is reported
 * separately from an inactive account, so that when two-factor sign-in is
 * switched on (private.auth_policy) only that screen needs to change.
 */
export function accessFor(who: WhoAmI): Access {
  if (who.effectiveRole) return { kind: 'ready', who, role: who.effectiveRole };
  if (who.profile?.isActive && who.requiredAal === 'aal2' && who.sessionAal !== 'aal2') {
    return { kind: 'mfa_required', who };
  }
  return { kind: 'inactive', who };
}

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  weak_password: 'Choose a longer, less common password.',
  same_password: 'The new password must be different from the old one.',
  session_expired: 'Your session has ended. Sign in again.',
  network: 'Could not reach the server. Check your connection and try again.',
  not_authorized: 'Your account is not allowed to do this.',
  stale_record: 'Someone else changed this since you opened it. Reload and try again.',
  reason_required: 'Give a short reason for this change.',
  invalid_profile: 'Check the name and phone number.',
  last_owner: 'There must always be at least one active owner.',
  not_found: 'This record no longer exists.',
  // Appointments and customers (Phase 5b)
  slot_unavailable: 'That time is no longer free for this therapist.',
  schedule_rule: 'That time is outside the booking rules.',
  invalid_status: 'This booking can no longer be changed that way.',
  appointment_started: 'This appointment has already started and cannot be moved.',
  start_in_past: 'Choose a time in the future.',
  not_started: 'This appointment has not started yet.',
  invalid_time: 'Choose a date and time.',
  invalid_contact: 'Check the contact name and phone number.',
  invalid_customer: 'Check the customer details: a name and an email or phone number are needed.',
  invalid_booking: 'Notes are too long.',
  address_required: 'An address is needed for an in-home booking.',
  address_not_applicable: 'Only in-home bookings have an address.',
  dispatch_zone_required: 'Choose the area for an in-home booking.',
  therapist_unavailable: 'That therapist does not offer this treatment or is not available.',
  service_unavailable: 'That treatment is not available.',
  email_in_use: 'Another customer already has this email address.',
  invalid_source: 'Online bookings are settled by their online payment and cannot be changed here.',
  invalid_range: 'Choose a shorter period.',
  not_configured: 'Booking settings are missing.',
};

/** Why a time is outside the booking rules (schedule_rule / slot_unavailable details). */
export const RULE_MESSAGES: Record<string, string> = {
  slot_taken: 'it overlaps another booking or a guest reservation',
  too_soon: 'it is sooner than the minimum notice',
  too_far: 'it is further ahead than bookings are taken',
  off_grid: 'it does not start on the booking grid',
  outside_business_hours: 'it is outside opening hours',
  blackout: 'the business is closed then',
  outside_shift: 'it is outside the therapist\'s shift',
  on_break: 'it falls in the therapist\'s break',
  time_off: 'the therapist is off then',
};

export function messageFor(err: unknown): string {
  const code = err instanceof StaffError ? err.code : 'unknown';
  const base = MESSAGES[code] ?? 'Something went wrong. Try again.';
  if (err instanceof StaffError && err.detail && RULE_MESSAGES[err.detail] && (code === 'schedule_rule' || code === 'slot_unavailable')) {
    return `${code === 'schedule_rule' ? 'That time is outside the booking rules' : 'That time cannot be booked'}: ${RULE_MESSAGES[err.detail]}.`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Supabase implementation

function authError(error: AuthError | Error): StaffError {
  const e = error as AuthError & { code?: string; status?: number };
  if (e.code === 'invalid_credentials' || /invalid login credentials/i.test(e.message)) return new StaffError('invalid_credentials');
  if (e.code === 'over_request_rate_limit' || e.code === 'over_email_send_rate_limit' || e.status === 429) return new StaffError('rate_limited');
  if (e.code === 'weak_password') return new StaffError('weak_password');
  if (e.code === 'same_password') return new StaffError('same_password');
  if (e.code === 'session_not_found' || e.code === 'refresh_token_not_found' || e.name === 'AuthSessionMissingError') return new StaffError('session_expired');
  if (e.name === 'AuthRetryableFetchError' || e instanceof TypeError) return new StaffError('network');
  return new StaffError('unknown');
}

/** Database errors raised by the staff functions carry a known code as their message. */
export function dbError(error: { message: string; code?: string; details?: string | null }): StaffError {
  if (error.code === '42501') return new StaffError('not_authorized');
  return new StaffError(MESSAGES[error.message] ? error.message : 'unknown', error.details ?? undefined);
}

const AUTH_EVENTS: AuthEvent[] = ['SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED', 'USER_UPDATED', 'PASSWORD_RECOVERY'];

export function createSupabaseBackend(client: SupabaseClient): StaffBackend {
  return {
    async getSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw authError(error);
      return data.session ? { email: data.session.user.email ?? null } : null;
    },

    onAuthChange(callback) {
      const { data } = client.auth.onAuthStateChange((event) => {
        const known = (AUTH_EVENTS as string[]).includes(event) ? (event as AuthEvent) : 'OTHER';
        // supabase-js holds a lock during this callback; calling it back from
        // inside would deadlock, so react on the next tick.
        setTimeout(() => callback(known), 0);
      });
      return () => data.subscription.unsubscribe();
    },

    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw authError(error);
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw authError(error);
    },

    async requestPasswordReset(email, redirectTo) {
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (error) throw authError(error);
    },

    async updatePassword(newPassword) {
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw authError(error);
    },

    async whoami() {
      const { data, error } = await client.rpc('staff_whoami');
      if (error) throw dbError(error);
      const p = data.profile;
      return {
        userId: data.user_id,
        profile: p
          ? { id: p.id, fullName: p.full_name, phone: p.phone, role: p.role, isActive: p.is_active, updatedAt: p.updated_at }
          : null,
        effectiveRole: data.effective_role,
        therapistId: data.therapist_id,
        sessionAal: data.session_aal,
        requiredAal: data.required_aal,
      };
    },

    async updateOwnProfile(fullName, phone, expectedUpdatedAt) {
      const { error } = await client.rpc('staff_update_own_profile', {
        p_full_name: fullName,
        p_phone: phone,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw dbError(error);
    },
  };
}
