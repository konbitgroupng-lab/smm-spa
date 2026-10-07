/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL. Safe for the browser. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon (publishable) key. Safe for the browser; RLS limits what it can do. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
