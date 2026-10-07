// Backend configuration from the build environment. Kept apart from the
// Supabase client so pages can check it without loading the client library.

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False until VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set; the site then runs on static content. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
