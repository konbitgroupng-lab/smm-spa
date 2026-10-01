import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False until VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set; the site then runs on static content. */
export const isSupabaseConfigured = Boolean(url && anonKey);

// Browser client. It only ever holds the anon key: every request is subject to
// Row Level Security. The service-role key must never be imported into src/.
export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url!, anonKey!) : null;

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
