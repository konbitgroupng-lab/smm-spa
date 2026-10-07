import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isSupabaseConfigured } from '../lib/env';
import { readAuthLink } from './lib/authLink';
import { createSupabaseBackend } from './lib/backend';
import { staffClient } from './lib/client';
import StaffApp from './StaffApp';
import '../index.css';

// Note what kind of link opened the app before the Supabase client reads the
// tokens from the address bar and removes them.
const initialLink = readAuthLink(window.location.hash);
const backend = isSupabaseConfigured ? createSupabaseBackend(staffClient()) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StaffApp backend={backend} initialLink={initialLink} resetRedirect={`${window.location.origin}/staff/`} />
  </StrictMode>,
);
