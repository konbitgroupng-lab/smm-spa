import { useState, type FormEvent } from 'react';
import { messageFor, StaffError, type StaffBackend } from '../lib/backend';
import { AuthCard, ErrorMessage, Field, LinkButton, Notice, PrimaryButton } from '../ui';

/** Kept in step with the minimum password length set in the Supabase project's Auth settings. */
export const MIN_PASSWORD_LENGTH = 10;

export function SignInScreen({ backend, notice, onSignedIn, onForgot }: {
  backend: StaffBackend;
  notice?: string;
  onSignedIn: () => void;
  onForgot: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await backend.signIn(email, password);
      setPassword('');
      onSignedIn();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Sign in">
      <Notice>{notice}</Notice>
      <form onSubmit={submit}>
        <ErrorMessage>{error}</ErrorMessage>
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <PrimaryButton busy={busy}>{busy ? 'Signing in…' : 'Sign in'}</PrimaryButton>
      </form>
      <div className="mt-4 text-center">
        <LinkButton onClick={onForgot}>Forgot your password?</LinkButton>
      </div>
    </AuthCard>
  );
}

export function ForgotPasswordScreen({ backend, redirectTo, onBack }: {
  backend: StaffBackend;
  redirectTo: string;
  onBack: () => void;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await backend.requestPasswordReset(email, redirectTo);
      setSent(true);
    } catch (err) {
      // The reply never says whether the address has an account.
      if (err instanceof StaffError && (err.code === 'rate_limited' || err.code === 'network')) setError(messageFor(err));
      else setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Reset your password">
      {sent ? (
        <Notice>If that email belongs to a staff account, a reset link is on its way. It can be used once.</Notice>
      ) : (
        <form onSubmit={submit}>
          <ErrorMessage>{error}</ErrorMessage>
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" />
          <PrimaryButton busy={busy}>{busy ? 'Sending…' : 'Send reset link'}</PrimaryButton>
        </form>
      )}
      <div className="mt-4 text-center">
        <LinkButton onClick={onBack}>Back to sign in</LinkButton>
      </div>
    </AuthCard>
  );
}

export function SetPasswordScreen({ backend, link, onDone }: {
  backend: StaffBackend;
  link: 'recovery' | 'invite';
  onDone: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await backend.updatePassword(password);
      onDone();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={link === 'invite' ? 'Choose your password' : 'Set a new password'}>
      <form onSubmit={submit}>
        <ErrorMessage>{error}</ErrorMessage>
        <Field label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
        <Field label="Repeat new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <PrimaryButton busy={busy}>{busy ? 'Saving…' : 'Save password'}</PrimaryButton>
      </form>
    </AuthCard>
  );
}

/** Signed in, but the database grants no staff access (yet). */
export function NoAccessScreen({ reason, onSignOut }: { reason: 'inactive' | 'mfa_required'; onSignOut: () => void }) {
  return (
    <AuthCard title={reason === 'inactive' ? 'Account not active' : 'Extra verification needed'}>
      <p className="text-sm text-spa-charcoal mb-6">
        {reason === 'inactive'
          ? 'Your account has not been given access to the staff area, or its access has been removed. Ask the owner to activate it.'
          : 'Your account must sign in with two-step verification, which this version of the staff app does not offer yet. Contact the owner.'}
      </p>
      <PrimaryButton type="button" onClick={onSignOut}>Sign out</PrimaryButton>
    </AuthCard>
  );
}
