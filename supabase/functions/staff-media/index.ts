// Supabase Edge Function entry point (Deno). Wires the runtime to handler.ts.
//
// Settings come from the function environment, never from the browser:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   provided by Supabase
//   ALLOWED_ORIGINS    comma-separated origins of the staff app, e.g. "https://example.com"

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleMediaRequest } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const BUCKET = 'site-media';

Deno.serve((req) =>
  handleMediaRequest(req, {
    allowedOrigins,
    rpc: async (fn, args) => {
      const { data, error } = await admin.rpc(fn, args);
      return { data, error };
    },
    rpcAsCaller: async (token, fn, args) => {
      const asCaller = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data, error } = await asCaller.rpc(fn, args);
      return { data, error };
    },
    store: async (path, bytes, contentType) => {
      const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false, cacheControl: '31536000' });
      return { ok: !error };
    },
    discard: async (path) => {
      const { error } = await admin.storage.from(BUCKET).remove([path]);
      return { ok: !error };
    },
  }),
);
