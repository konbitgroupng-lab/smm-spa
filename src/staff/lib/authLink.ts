// Invite and password-reset emails open the staff app with the result in the
// address bar's fragment, e.g. "#access_token=...&type=recovery", or
// "#error=access_denied&error_code=otp_expired&..." for a used or expired link.

export type AuthLink =
  | { kind: 'recovery' }
  | { kind: 'invite' }
  | { kind: 'expired' }
  | null;

export function readAuthLink(hash: string): AuthLink {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.has('error') || params.has('error_code')) return { kind: 'expired' };
  if (!params.has('access_token')) return null;
  const type = params.get('type');
  if (type === 'recovery') return { kind: 'recovery' };
  if (type === 'invite') return { kind: 'invite' };
  return null;
}

/** True when the fragment carries auth parameters rather than an app route. */
export function isAuthFragment(hash: string): boolean {
  return /[#&](access_token|refresh_token|error|error_code)=/.test(hash.startsWith('#') ? hash : `#${hash}`);
}
