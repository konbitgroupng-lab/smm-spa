import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from '../../lib/env';

/**
 * The staff app's own Supabase client, separate from the public website's
 * (which keeps no session at all). The staff session is stored under its own
 * key, and invite and password-reset links are read from the address bar.
 *
 * The implicit flow is used because invite links are generated on the server:
 * there is no browser-held verifier for a PKCE exchange.
 */
export const STAFF_AUTH_OPTIONS = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  flowType: 'implicit',
  storageKey: 'smm-staff-auth',
} as const;

let client: SupabaseClient | null = null;

/**
 * Created on first use, so the app can note what kind of link it was opened
 * from before the client reads (and clears) the address bar.
 */
export function staffClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  client ??= createClient(supabaseUrl!, supabaseAnonKey!, { auth: STAFF_AUTH_OPTIONS });
  return client;
}
