// Owner-only staff invitation (Decision J).
//
// Sending an invitation needs the server-only key, so it happens here. The
// caller's own sign-in token decides whether they may: the database is asked,
// as the caller, who they are (staff_whoami), and only an active owner
// passes. The invitation itself is Supabase Auth's own (an email with a
// link to set a password). The new account starts inactive, with no staff
// access, until the owner activates it in the staff app.
//
// Web-standard APIs only, so the same code runs in the Edge runtime
// (index.ts) and in the Node tests.

import { corsHeaders, readJsonObject, withinRateLimit, type Rpc } from '../_shared/http.ts';

export interface InviteDeps {
  allowedOrigins: string[];
  /** Database calls with service-role privileges (rate limiting only). */
  rpc: Rpc;
  /** A database function called as the signed-in caller, with their token. */
  rpcAsCaller: (token: string, fn: string, args: Record<string, unknown>) => ReturnType<Rpc>;
  /** Sends a Supabase Auth invitation; returns the new user's id. */
  invite: (email: string, fullName: string) => Promise<{ userId: string } | { error: 'already_registered' | 'failed' }>;
}

const MAX_BODY_BYTES = 2048;
const INVITES_PER_HOUR = 20;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function handleInviteRequest(req: Request, deps: InviteDeps): Promise<Response> {
  const headers = corsHeaders(req.headers.get('origin'), deps.allowedOrigins);
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return reply(401, { error: 'not_authorized' });

  // Who is asking, according to the database, as themselves.
  const who = await deps.rpcAsCaller(token, 'staff_whoami', {});
  if (who.error || !who.data || who.data.effective_role !== 'owner') return reply(403, { error: 'not_authorized' });
  const callerId = String(who.data.user_id);

  const body = await readJsonObject(req, MAX_BODY_BYTES);
  if (body === 'too_large') return reply(413, { error: 'too_large' });
  if (body === 'invalid') return reply(400, { error: 'invalid_request' });
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  if (!EMAIL.test(email) || email.length > 254 || fullName.length < 2 || fullName.length > 120) {
    return reply(422, { error: 'invalid_invitation' });
  }

  try {
    if (!(await withinRateLimit(deps.rpc, `staff-invite:${callerId}`, INVITES_PER_HOUR, 3600))) {
      return reply(429, { error: 'rate_limited' });
    }
  } catch {
    return reply(500, { error: 'server_error' });
  }

  const sent = await deps.invite(email, fullName);
  if ('error' in sent) {
    return sent.error === 'already_registered' ? reply(409, { error: 'already_registered' }) : reply(502, { error: 'invite_failed' });
  }

  // Record who invited the account (as the owner, so the log shows them).
  const recorded = await deps.rpcAsCaller(token, 'owner_record_invitation', { p_profile_id: sent.userId });
  return reply(200, { profileId: sent.userId, recorded: !recorded.error });
}
