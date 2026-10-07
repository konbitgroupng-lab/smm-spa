// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StaffApp from '../../src/staff/StaffApp';
import { readAuthLink, type AuthLink } from '../../src/staff/lib/authLink';
import { StaffError, type AuthEvent, type StaffBackend, type StaffRole, type WhoAmI } from '../../src/staff/lib/backend';
import { sectionFromHash, sectionsFor } from '../../src/staff/sections';

// The staff app's screens against a scripted backend. What each role may do is
// proven in the database tests; these check that the app reflects it.

function who(role: StaffRole | null, overrides: Partial<WhoAmI> = {}, active = role !== null): WhoAmI {
  return {
    userId: 'user-1',
    profile: { id: 'user-1', fullName: 'Ada Staff', phone: null, role: role ?? 'therapist', isActive: active, updatedAt: '2026-10-08T09:00:00.123456+00:00' },
    effectiveRole: role,
    therapistId: role === 'therapist' ? 'therapist-1' : null,
    sessionAal: 'aal1',
    requiredAal: 'aal1',
    ...overrides,
  };
}

class FakeBackend implements StaffBackend {
  session: { email: string | null } | null = null;
  identity: WhoAmI = who('owner');
  listeners: ((e: AuthEvent) => void)[] = [];
  getSession = vi.fn(async () => this.session);
  onAuthChange = vi.fn((cb: (e: AuthEvent) => void) => {
    this.listeners.push(cb);
    return () => (this.listeners = this.listeners.filter((l) => l !== cb));
  });
  signIn = vi.fn(async (email: string, password: string) => {
    if (password !== 'right password') throw new StaffError('invalid_credentials');
    this.session = { email };
  });
  signOut = vi.fn(async () => {
    this.session = null;
  });
  requestPasswordReset = vi.fn(async (_email: string, _redirect: string) => {});
  updatePassword = vi.fn(async (_pw: string) => {});
  whoami = vi.fn(async () => this.identity);
  updateOwnProfile = vi.fn(async (_n: string, _p: string | null, _v: string) => {});
  emit(event: AuthEvent) {
    act(() => this.listeners.forEach((l) => l(event)));
  }
}

function start(backend: StaffBackend | null, link: AuthLink = null) {
  return render(<StaffApp backend={backend} initialLink={link} resetRedirect="https://example.test/staff/" />);
}

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('signing in', () => {
  it('shows sign-in when there is no session, and a neutral message for a wrong password', async () => {
    const backend = new FakeBackend();
    start(backend);
    await userEvent.type(await screen.findByLabelText('Email'), 'owner@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Email or password is incorrect.');
    expect(backend.whoami).not.toHaveBeenCalled();
  });

  it('after signing in, the role the database reports decides the navigation', async () => {
    const backend = new FakeBackend();
    start(backend);
    await userEvent.type(await screen.findByLabelText('Email'), 'owner@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'right password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const nav = await screen.findByRole('navigation', { name: 'Staff sections' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Bookings', 'Schedules', 'Services & therapists', 'Payments', 'Staff accounts', 'Settings', 'Activity log', 'My account',
    ]);
  });

  it.each([
    ['admin', ['Bookings', 'Schedules', 'Services & therapists', 'Payments', 'Settings', 'Activity log', 'My account']],
    ['therapist', ['My agenda', 'My account']],
  ] as const)('%s sees only their sections', async (role, labels) => {
    const backend = new FakeBackend();
    backend.session = { email: `${role}@example.com` };
    backend.identity = who(role);
    start(backend);
    const nav = await screen.findByRole('navigation', { name: 'Staff sections' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(labels);
  });

  it('a section the role may not see falls back to its first section', async () => {
    window.location.hash = '#/staff';
    const backend = new FakeBackend();
    backend.session = { email: 't@example.com' };
    backend.identity = who('therapist');
    start(backend);
    expect(await screen.findByRole('heading', { level: 1, name: 'My agenda' })).toBeTruthy();
    expect(screen.queryByText('Staff accounts')).toBeNull();
  });
});

describe('accounts without access', () => {
  it('an inactive or brand-new account is told so, and can sign out', async () => {
    const backend = new FakeBackend();
    backend.session = { email: 'new@example.com' };
    backend.identity = who(null, {}, false);
    start(backend);
    expect(await screen.findByRole('heading', { name: 'Account not active' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(backend.signOut).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('an owner whose role requires two-step verification is stopped at that screen', async () => {
    const backend = new FakeBackend();
    backend.session = { email: 'owner@example.com' };
    backend.identity = who(null, { requiredAal: 'aal2', sessionAal: 'aal1' }, true);
    backend.identity.profile!.role = 'owner';
    start(backend);
    expect(await screen.findByRole('heading', { name: 'Extra verification needed' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('losing access mid-session takes effect on the next check', async () => {
    const backend = new FakeBackend();
    backend.session = { email: 'admin@example.com' };
    backend.identity = who('admin');
    start(backend);
    await screen.findByRole('navigation', { name: 'Staff sections' });
    backend.identity = who(null, {}, false);
    backend.emit('TOKEN_REFRESHED');
    expect(await screen.findByRole('heading', { name: 'Account not active' })).toBeTruthy();
  });

  it('signing out elsewhere returns to sign-in', async () => {
    const backend = new FakeBackend();
    backend.session = { email: 'admin@example.com' };
    backend.identity = who('admin');
    start(backend);
    await screen.findByRole('navigation', { name: 'Staff sections' });
    backend.emit('SIGNED_OUT');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
});

describe('password links', () => {
  it('reads invite, recovery and expired links from the address bar', () => {
    expect(readAuthLink('#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=recovery')).toEqual({ kind: 'recovery' });
    expect(readAuthLink('#access_token=a&refresh_token=b&type=invite')).toEqual({ kind: 'invite' });
    expect(readAuthLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')).toEqual({ kind: 'expired' });
    expect(readAuthLink('#access_token=a&type=magiclink')).toBeNull();
    expect(readAuthLink('#/bookings')).toBeNull();
    expect(readAuthLink('')).toBeNull();
  });

  it('an invite link asks for a password before anything else, then opens the app', async () => {
    const backend = new FakeBackend();
    backend.session = { email: 'new.therapist@example.com' };
    backend.identity = who('therapist');
    start(backend, { kind: 'invite' });
    expect(await screen.findByRole('heading', { name: 'Choose your password' })).toBeTruthy();
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Use at least 10 characters.');
    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.clear(screen.getByLabelText('Repeat new password'));
    await userEvent.type(screen.getByLabelText('New password'), 'a long new password');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'a long new passw0rd');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The two passwords do not match.');
    await userEvent.clear(screen.getByLabelText('Repeat new password'));
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'a long new password');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('navigation', { name: 'Staff sections' })).toBeTruthy();
    expect(backend.updatePassword).toHaveBeenCalledWith('a long new password');
  });

  it('a reset link without a valid session lands on sign-in with an explanation', async () => {
    start(new FakeBackend(), { kind: 'recovery' });
    expect(await screen.findByText(/invalid or has already been used/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('an expired link is explained on the sign-in screen', async () => {
    start(new FakeBackend(), { kind: 'expired' });
    expect(await screen.findByText(/invalid or has already been used/)).toBeTruthy();
  });

  it('forgot password never reveals whether an account exists', async () => {
    const backend = new FakeBackend();
    backend.requestPasswordReset.mockRejectedValueOnce(new StaffError('unknown'));
    start(backend);
    await userEvent.click(await screen.findByRole('button', { name: 'Forgot your password?' }));
    await userEvent.type(screen.getByLabelText('Email'), 'someone@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/If that email belongs to a staff account/);
    expect(backend.requestPasswordReset).toHaveBeenCalledWith('someone@example.com', 'https://example.test/staff/');
  });
});

describe('my account', () => {
  it('saves name and phone with the version that was shown, and explains a stale edit', async () => {
    window.location.hash = '#/account';
    const backend = new FakeBackend();
    backend.session = { email: 'owner@example.com' };
    start(backend);
    const name = await screen.findByLabelText('Full name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Ada Owner');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(backend.updateOwnProfile).toHaveBeenCalledWith('Ada Owner', null, '2026-10-08T09:00:00.123456+00:00'));

    backend.updateOwnProfile.mockRejectedValueOnce(new StaffError('stale_record'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Someone else changed this since you opened it. Reload and try again.');
  });
});

describe('sections and configuration', () => {
  it('section routing ignores auth fragments', () => {
    expect(sectionFromHash('#access_token=abc&type=recovery', 'owner').id).toBe('bookings');
    expect(sectionFromHash('#/activity', 'admin').id).toBe('activity');
    expect(sectionFromHash('#/staff', 'admin').id).toBe('bookings');
    expect(sectionsFor('therapist').map((s) => s.id)).toEqual(['agenda', 'account']);
  });

  it('without a backend, the staff app says so', () => {
    start(null);
    expect(screen.getByRole('heading', { name: 'Staff area unavailable' })).toBeTruthy();
  });
});
