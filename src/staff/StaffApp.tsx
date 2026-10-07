import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthLink } from './lib/authLink';
import { accessFor, type Access, type StaffBackend } from './lib/backend';
import { StaffShell } from './StaffShell';
import { ForgotPasswordScreen, NoAccessScreen, SetPasswordScreen, SignInScreen } from './screens/AuthScreens';
import { AuthCard, PrimaryButton } from './ui';

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'forgot' } | Access;

const EXPIRED_LINK = 'That link is invalid or has already been used. Sign in, or ask for a new link.';

/**
 * The staff app: who is signed in decides what is shown, and the database
 * decides who is staff (staff_whoami). Nothing here grants access by itself.
 */
export default function StaffApp({ backend, initialLink, resetRedirect }: {
  backend: StaffBackend | null;
  /** What the address bar carried when the app opened (read before the client cleared it). */
  initialLink: AuthLink;
  /** Where password-reset emails send people back to. */
  resetRedirect: string;
}) {
  const pendingLink = useRef<'recovery' | 'invite' | null>(
    initialLink?.kind === 'recovery' || initialLink?.kind === 'invite' ? initialLink.kind : null,
  );
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [email, setEmail] = useState<string | null>(null);
  const [notice, setNotice] = useState(initialLink?.kind === 'expired' ? EXPIRED_LINK : '');
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    if (!backend) return;
    const call = ++latest.current; // a slower, older answer must not overwrite a newer one
    try {
      const session = await backend.getSession();
      if (call !== latest.current) return;
      if (!session) {
        if (pendingLink.current) {
          pendingLink.current = null;
          setNotice(EXPIRED_LINK);
        }
        setView({ kind: 'signed_out' });
        return;
      }
      setEmail(session.email);
      if (pendingLink.current) {
        setView({ kind: 'set_password', link: pendingLink.current });
        return;
      }
      const who = await backend.whoami();
      if (call === latest.current) setView(accessFor(who));
    } catch {
      if (call === latest.current) setView({ kind: 'error' });
    }
  }, [backend]);

  useEffect(() => {
    if (!backend) return;
    void refresh();
    return backend.onAuthChange((event) => {
      if (event === 'SIGNED_OUT') {
        latest.current++;
        pendingLink.current = null;
        setView({ kind: 'signed_out' });
        return;
      }
      if (event === 'PASSWORD_RECOVERY') pendingLink.current = 'recovery';
      void refresh();
    });
  }, [backend, refresh]);

  async function signOut() {
    try {
      await backend!.signOut();
    } catch {
      // Signed out locally either way.
    }
    latest.current++;
    pendingLink.current = null;
    setNotice('');
    setView({ kind: 'signed_out' });
  }

  if (!backend) {
    return (
      <AuthCard title="Staff area unavailable">
        <p className="text-sm">The staff app is not connected to a backend in this build.</p>
      </AuthCard>
    );
  }

  switch (view.kind) {
    case 'loading':
      return (
        <AuthCard title="Loading…">
          <p className="text-sm text-spa-clay" role="status">Checking your sign-in.</p>
        </AuthCard>
      );
    case 'error':
      return (
        <AuthCard title="Could not load the staff area">
          <p className="text-sm mb-6">Check your connection and try again.</p>
          <PrimaryButton type="button" onClick={() => void refresh()}>Try again</PrimaryButton>
        </AuthCard>
      );
    case 'signed_out':
      return (
        <SignInScreen
          backend={backend}
          notice={notice}
          onSignedIn={() => {
            setNotice('');
            void refresh();
          }}
          onForgot={() => setView({ kind: 'forgot' })}
        />
      );
    case 'forgot':
      return <ForgotPasswordScreen backend={backend} redirectTo={resetRedirect} onBack={() => setView({ kind: 'signed_out' })} />;
    case 'set_password':
      return (
        <SetPasswordScreen
          backend={backend}
          link={view.link}
          onDone={() => {
            pendingLink.current = null;
            setNotice('');
            void refresh();
          }}
        />
      );
    case 'inactive':
    case 'mfa_required':
      return <NoAccessScreen reason={view.kind} onSignOut={() => void signOut()} />;
    case 'ready':
      return <StaffShell backend={backend} who={view.who} role={view.role} email={email} onRefresh={refresh} onSignOut={() => void signOut()} />;
  }
}
