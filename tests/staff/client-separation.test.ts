// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import { PUBLIC_AUTH_OPTIONS } from '../../src/lib/supabase';
import { STAFF_AUTH_OPTIONS } from '../../src/staff/lib/client';

// Decision M: the public website keeps no login session, and the staff app's
// session lives apart from it.

const root = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

afterEach(() => {
  localStorage.clear();
  window.location.hash = '';
});

describe('public and staff clients', () => {
  it('the public client stores nothing and ignores login links in the address bar', async () => {
    window.location.hash = '#access_token=stolen.or.forwarded&refresh_token=r&expires_in=3600&token_type=bearer&type=recovery';
    const client = createClient('http://127.0.0.1:9', 'anon-key', { auth: PUBLIC_AUTH_OPTIONS });
    const { data } = await client.auth.getSession();
    expect(data.session).toBeNull();
    expect(window.location.hash).toContain('access_token'); // not read, not consumed
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it('the staff client keeps its session under its own key and reads its links', () => {
    expect(STAFF_AUTH_OPTIONS).toMatchObject({ persistSession: true, detectSessionInUrl: true, storageKey: 'smm-staff-auth' });
    expect(PUBLIC_AUTH_OPTIONS).toMatchObject({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
    expect(PUBLIC_AUTH_OPTIONS.storageKey).not.toBe(STAFF_AUTH_OPTIONS.storageKey);
  });

  it('the public website does not import the staff app', () => {
    const outside = sourceFiles(path.join(root, 'src')).filter((f) => !f.includes(`${path.sep}staff${path.sep}`));
    const offenders = outside.filter((f) => /from ['"][^'"]*\/staff\//.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no service-role key or provider secret is referenced anywhere in the frontend', () => {
    const offenders = sourceFiles(path.join(root, 'src')).filter((f) =>
      /SERVICE_ROLE|service_role|PAYSTACK_SECRET|sk_(test|live)_/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the staff page is kept out of search engines', () => {
    const html = readFileSync(path.join(root, 'staff/index.html'), 'utf8');
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    expect(html).toContain('/src/staff/main.tsx');
  });
});
