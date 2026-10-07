/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL. Safe for the browser. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon (publishable) key. Safe for the browser; RLS limits what it can do. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** "true" to serve the booking prototype page (?view=booking-prototype) outside development builds. */
  readonly VITE_ENABLE_BOOKING_PROTOTYPE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
