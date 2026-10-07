import { useState, type FormEvent } from 'react';
import { messageFor, type StaffBackend, type WhoAmI } from '../lib/backend';
import { ErrorMessage, Field, Notice, PrimaryButton } from '../ui';
import { MIN_PASSWORD_LENGTH } from './AuthScreens';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', therapist: 'Therapist' } as const;

export function AccountScreen({ backend, who, email, onChanged }: {
  backend: StaffBackend;
  who: WhoAmI;
  email: string | null;
  onChanged: () => Promise<void>;
}) {
  const profile = who.profile!;
  return (
    <div className="space-y-8 max-w-lg">
      <section>
        <h1 className="font-serif text-2xl mb-2">My account</h1>
        <p className="text-sm text-spa-clay">
          {email} · {ROLE_LABEL[profile.role]}
        </p>
      </section>
      <ProfileForm key={profile.updatedAt} backend={backend} who={who} onChanged={onChanged} />
      <PasswordForm backend={backend} />
    </div>
  );
}

function ProfileForm({ backend, who, onChanged }: { backend: StaffBackend; who: WhoAmI; onChanged: () => Promise<void> }) {
  const profile = who.profile!;
  const [fullName, setFullName] = useState(profile.fullName);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved('');
    try {
      await backend.updateOwnProfile(fullName, phone.trim() || null, profile.updatedAt);
      await onChanged();
      setSaved('Saved.');
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="profile-heading">
      <h3 id="profile-heading" className="font-medium mb-3">Name and phone</h3>
      <ErrorMessage>{error}</ErrorMessage>
      <Notice>{saved}</Notice>
      <Field label="Full name" value={fullName} onChange={setFullName} autoComplete="name" />
      <Field label="Phone" type="tel" value={phone} onChange={setPhone} autoComplete="tel" required={false} />
      <PrimaryButton busy={busy}>{busy ? 'Saving…' : 'Save'}</PrimaryButton>
    </form>
  );
}

function PasswordForm({ backend }: { backend: StaffBackend }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaved('');
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await backend.updatePassword(password);
      setPassword('');
      setConfirm('');
      setSaved('Password changed.');
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="password-heading">
      <h3 id="password-heading" className="font-medium mb-3">Change password</h3>
      <ErrorMessage>{error}</ErrorMessage>
      <Notice>{saved}</Notice>
      <Field label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
      <Field label="Repeat new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <PrimaryButton busy={busy}>{busy ? 'Saving…' : 'Change password'}</PrimaryButton>
    </form>
  );
}
