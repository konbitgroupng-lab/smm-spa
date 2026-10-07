import { useEffect, useState } from 'react';
import { isAuthFragment } from './lib/authLink';

// "#/<section>/<path...>?<params>" routes inside the staff app.

export interface Route {
  section: string;
  path: string[];
  params: URLSearchParams;
}

export function parseRoute(hash: string): Route {
  if (isAuthFragment(hash)) return { section: '', path: [], params: new URLSearchParams() };
  const [pathPart, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [section = '', ...path] = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  return { section, path, params: new URLSearchParams(query) };
}

export function href(section: string, path: string[] = [], params?: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v) query.set(k, v);
  const qs = query.toString();
  return `#/${[section, ...path].map(encodeURIComponent).join('/')}${qs ? `?${qs}` : ''}`;
}

export function navigate(to: string): void {
  window.location.hash = to.replace(/^#/, '');
}

/** The current hash, kept up to date. */
export function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return hash;
}
