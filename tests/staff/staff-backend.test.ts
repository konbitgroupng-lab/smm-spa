import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accessFor, createSupabaseBackend, messageFor, StaffError, type StaffBackend } from '../../src/staff/lib/backend';
import { STAFF_AUTH_OPTIONS } from '../../src/staff/lib/client';
import { createStaff, createTestDb } from '../db/harness';
import { startLocalBackend } from '../support/local-backend';

// The staff app's real Supabase client and adapter, over HTTP, against the
// real database functions (Auth is a minimal local stand-in).

const PASSWORD = 'correct horse battery';
let db: PGlite;
let backend: { url: string; close(): Promise<void> };

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

function newClient(): SupabaseClient {
  return createClient(backend.url, 'local-anon-key', { auth: { ...STAFF_AUTH_OPTIONS, storage: memoryStorage() } });
}

async function signedIn(email: string): Promise<{ client: SupabaseClient; staff: StaffBackend }> {
  const client = newClient();
  const staff = createSupabaseBackend(client);
  await staff.signIn(email, PASSWORD);
  return { client, staff };
}

async function failure(promise: Promise<unknown>): Promise<StaffError> {
  try {
    await promise;
  } catch (err) {
    return err as StaffError;
  }
  throw new Error('expected a failure');
}

beforeAll(async () => {
  db = await createTestDb();
  await createStaff(db, 'owner@example.com', 'owner');
  await createStaff(db, 'therapist@example.com', 'therapist');
  await createStaff(db, 'inactive@example.com', 'admin', { active: false });
  backend = await startLocalBackend(db, 'http://localhost:3000', { staffPassword: PASSWORD });
});

afterAll(async () => {
  await backend?.close();
});

describe('staff sign-in and identity through the real client', () => {
  it('a wrong password gets one neutral message', async () => {
    const staff = createSupabaseBackend(newClient());
    const err = await failure(staff.signIn('owner@example.com', 'wrong password'));
    expect(err).toBeInstanceOf(StaffError);
    expect(messageFor(err)).toBe('Email or password is incorrect.');
    const unknown = await failure(staff.signIn('nobody@example.com', PASSWORD));
    expect(messageFor(unknown)).toBe(messageFor(err)); // no hint whether the account exists
  });

  it('an owner signs in and the database reports the role', async () => {
    const { staff } = await signedIn('owner@example.com');
    expect(await staff.getSession()).toEqual({ email: 'owner@example.com' });
    const who = await staff.whoami();
    expect(who).toMatchObject({ effectiveRole: 'owner', sessionAal: 'aal1', requiredAal: 'aal1', profile: { role: 'owner', isActive: true } });
    expect(typeof who.profile!.updatedAt).toBe('string');
    expect(accessFor(who).kind).toBe('ready');
  });

  it('an inactive account is signed in but gets no access', async () => {
    const { staff } = await signedIn('inactive@example.com');
    expect(accessFor(await staff.whoami()).kind).toBe('inactive');
  });

  it('own-profile edits carry the version, and an old version is refused', async () => {
    const { staff } = await signedIn('therapist@example.com');
    const before = await staff.whoami();
    await staff.updateOwnProfile('Therapist Renamed', '+2348011112222', before.profile!.updatedAt);
    const after = await staff.whoami();
    expect(after.profile).toMatchObject({ fullName: 'Therapist Renamed', phone: '+2348011112222', role: 'therapist' });
    const stale = await failure(staff.updateOwnProfile('Again', null, before.profile!.updatedAt));
    expect(messageFor(stale)).toBe('Someone else changed this since you opened it. Reload and try again.');
    const invalid = await failure(staff.updateOwnProfile('X', null, after.profile!.updatedAt));
    expect(messageFor(invalid)).toBe('Check the name and phone number.');
  });

  it('a therapist calling an owner function is refused by the database', async () => {
    const { client } = await signedIn('therapist@example.com');
    const { error } = await client.rpc('owner_update_payment_settings', {
      p_expected_updated_at: new Date().toISOString(), p_reason: 'trying it',
    });
    expect(error).toMatchObject({ code: '42501', message: 'not_authorized' });
  });

  it('without signing in, staff functions are refused outright', async () => {
    const { error } = await newClient().rpc('staff_whoami');
    expect(error).toMatchObject({ code: '42501' });
    expect(error!.message).toMatch(/permission denied/);
  });

  it('password changes and sign-out', async () => {
    const { staff } = await signedIn('owner@example.com');
    expect(messageFor(await failure(staff.updatePassword(PASSWORD)))).toBe('The new password must be different from the old one.');
    await staff.updatePassword('a different long password');
    await staff.signOut();
    expect(await staff.getSession()).toBeNull();
  });
});
