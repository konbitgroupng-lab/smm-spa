import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabaseAnonKey as anonKey, supabaseUrl as url } from './env';

export { isSupabaseConfigured };

/**
 * Auth settings for the public website's client. Guests never sign in, so this
 * client keeps no login session: nothing is stored in the browser, nothing is
 * refreshed, and login links in the address bar are ignored. Staff sign in
 * only in the staff app (/staff/), which has its own client and storage.
 */
export const PUBLIC_AUTH_OPTIONS = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
  storageKey: 'smm-public',
} as const;

// Browser client. It only ever holds the anon key: every request is subject to
// Row Level Security. The service-role key must never be imported into src/.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, { auth: PUBLIC_AUTH_OPTIONS })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  return supabase;
}

/** Public URL of a file in Supabase Storage. */
export function storagePublicUrl(bucket: string, path: string): string {
  return requireSupabase().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
