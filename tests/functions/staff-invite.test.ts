import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { handleInviteRequest, type InviteDeps } from '../../supabase/functions/staff-invite/handler';
import { asRole, createStaff, createTestDb, one, rows } from '../db/harness';
import { pgliteRpc } from '../support/rpc';

// The owner-only invitation function against the real database. The caller's
// "token" here is their user id: the test runs the database call as that user,
// exactly as the Edge Function does with the caller's real token.

const SITE = 'https://staff.example.test';
let db: PGlite;
let owner: string;
let admin: string;
let invitations: { email: string; fullName: string }[];

function deps(overrides: Partial<InviteDeps> = {}): InviteDeps {
  return {
    allowedOrigins: [SITE],
    rpc: pgliteRpc(db),
    rpcAsCaller: async (token, fn, args) => {
      const names = Object.keys(args);
      try {
        const r = await asRole(db, 'authenticated', token, () =>
          db.query<any>(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`, names.map((n) => args[n])));
        return { data: r.rows[0].v, error: null };
      } catch (err: any) {
        return { data: null, error: { code: err.code, message: err.message } };
      }
    },
    invite: async (email, fullName) => {
      if ((await rows(db, `select 1 from auth.users where lower(email) = $1`, [email])).length) return { error: 'already_registered' };
      invitations.push({ email, fullName });
      const { id } = await one(db, `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, JSON.stringify({ full_name: fullName })]);
      return { userId: id };
    },
    ...overrides,
  };
}

const post = (token: string | null, body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://local/functions/v1/staff-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeAll(async () => {
  db = await createTestDb();
  owner = await createStaff(db, 'owner@example.com', 'owner');
  admin = await createStaff(db, 'admin@example.com', 'admin');
});

describe('staff-invite', () => {
  it('an owner invites: an inactive account with no role is created, and the invitation is recorded', async () => {
    invitations = [];
    const res = await handleInviteRequest(post(owner, { email: ' New.Therapist@Example.com ', fullName: 'Ngozi Therapist' }), deps());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recorded).toBe(true);
    expect(invitations).toEqual([{ email: 'new.therapist@example.com', fullName: 'Ngozi Therapist' }]);
    expect(await one(db, `select role, is_active, full_name from profiles where id = $1`, [body.profileId]))
      .toEqual({ role: 'therapist', is_active: false, full_name: 'Ngozi Therapist' });
    expect(await one(db, `select actor_id, action from audit_log where action = 'staff.invited' and entity_id = $1`, [body.profileId]))
      .toEqual({ actor_id: owner, action: 'staff.invited' });
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE);
  });

  it('only an active owner may invite', async () => {
    invitations = [];
    expect((await handleInviteRequest(post(null, { email: 'a@example.com', fullName: 'Someone' }), deps())).status).toBe(401);
    expect((await handleInviteRequest(post(admin, { email: 'a@example.com', fullName: 'Someone' }), deps())).status).toBe(403);
    const inactive = await createStaff(db, 'gone.owner@example.com', 'owner', { active: false });
    expect((await handleInviteRequest(post(inactive, { email: 'a@example.com', fullName: 'Someone' }), deps())).status).toBe(403);
    expect((await handleInviteRequest(post('not-a-user', { email: 'a@example.com', fullName: 'Someone' }), deps())).status).toBe(403);
    expect(invitations).toEqual([]);
  });

  it('validates the request and explains refusals without detail', async () => {
    const send = async (body: unknown) => {
      const res = await handleInviteRequest(post(owner, body), deps());
      return [res.status, (await res.json()).error];
    };
    expect(await send({ email: 'not an email', fullName: 'Someone' })).toEqual([422, 'invalid_invitation']);
    expect(await send({ email: 'a@example.com', fullName: 'X' })).toEqual([422, 'invalid_invitation']);
    expect(await send('{not json')).toEqual([400, 'invalid_request']);
    expect(await send({ email: 'owner@example.com', fullName: 'Again' })).toEqual([409, 'already_registered']);
    const failing = await handleInviteRequest(post(owner, { email: 'b@example.com', fullName: 'Someone' }), deps({ invite: async () => ({ error: 'failed' }) }));
    expect([failing.status, (await failing.json()).error]).toEqual([502, 'invite_failed']);
    expect((await handleInviteRequest(new Request('http://local', { method: 'GET', headers: { origin: SITE } }), deps())).status).toBe(405);
    const preflight = await handleInviteRequest(new Request('http://local', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), deps());
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('limits how many invitations one owner sends per hour', async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await handleInviteRequest(post(owner, { email: `bulk${i}@example.com`, fullName: 'Bulk Person' }), deps())).status;
    }
    expect(last).toBe(429);
  });
});
