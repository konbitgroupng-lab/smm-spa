import type { Session, Subscription } from '@supabase/supabase-js';
import { requireSupabase } from '../lib/supabase';

// Staff authentication through Supabase Auth. Customers book as guests and never sign in.
// What a signed-in user may read or change is decided by RLS in the database,
// not by anything in this file.

export type StaffRole = 'owner' | 'admin' | 'therapist';

export interface StaffProfile {
  id: string;
  role: StaffRole;
  fullName: string;
  phone: string | null;
  isActive: boolean;
}

export async function signIn(email: string, password: string): Promise<Session> {
  const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signOut(): Promise<void> {
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(callback: (session: Session | null) => void): Subscription {
  return requireSupabase().auth.onAuthStateChange((_event, session) => callback(session)).data.subscription;
}

/** Emails a reset link; `redirectTo` must be listed in the project's Auth redirect URLs. */
export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  const { error } = await requireSupabase().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

/** Sets a new password for the signed-in user (after following a reset or invite link). */
export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await requireSupabase().auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/** Profile of the signed-in staff member, or null when signed out. */
export async function getCurrentProfile(): Promise<StaffProfile | null> {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('id, role, full_name, phone, is_active')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, role: data.role, fullName: data.full_name, phone: data.phone, isActive: data.is_active };
}
