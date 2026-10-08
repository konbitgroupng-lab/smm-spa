import { useState, type FormEvent } from 'react';
import { messageFor } from '../lib/backend';
import { ROLE_LABEL } from '../lib/labels';
import type { StaffAccount, StaffList, StaffOps } from '../lib/ops';
import { useLoad } from '../lib/useLoad';
import { href, type Route } from '../router';
import { Badge, Button, ErrorMessage, Field, LoadState, Notice, PageTitle, Panel, SelectField } from '../ui';
import { ChangeForm } from './ChangeForm';
import { dateTime } from './common';

/** Owner only: staff accounts, invitations, roles, activation and therapist links. */
export function StaffAccountsScreen({ ops, route, selfId }: { ops: StaffOps; route: Route; selfId: string }) {
  const list = useLoad(() => ops.staffList(), [ops]);
  const [sub] = route.path;
  return (
    <LoadState ready={!!list.data} error={list.error} onRetry={list.reload}>
      {() => {
        const account = list.data!.staff.find((s) => s.id === sub);
        if (sub && account) return <AccountDetail key={account.id} ops={ops} list={list.data!} account={account} selfId={selfId} reload={list.reload} />;
        return <AccountList ops={ops} list={list.data!} reload={list.reload} />;
      }}
    </LoadState>
  );
}

function AccountList({ ops, list, reload }: { ops: StaffOps; list: StaffList; reload: () => Promise<void> }) {
  return (
    <div>
      <PageTitle>Staff accounts</PageTitle>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr] items-start">
        <section aria-label="Accounts">
          <ul className="grid gap-2 sm:grid-cols-2">
            {list.staff.map((s) => (
              <li key={s.id}>
                <a href={href('staff', [s.id])} className="block rounded-lg border border-spa-taupe bg-white p-3 hover:border-spa-charcoal">
                  <span className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">{s.fullName || s.email}</span>
                    {s.isActive ? <Badge tone="bg-emerald-100 text-emerald-900">Active</Badge> : <Badge tone="bg-slate-200 text-slate-900">No access</Badge>}
                  </span>
                  <span className="block text-sm break-all">{s.email}</span>
                  <span className="block text-sm text-spa-clay">{ROLE_LABEL[s.role]}{s.therapist && ` · ${s.therapist.name}`}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
        <InviteForm ops={ops} reload={reload} />
      </div>
    </div>
  );
}

function InviteForm({ ops, reload }: { ops: StaffOps; reload: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setDone('');
    try {
      await ops.inviteStaff(email.trim(), name.trim());
      setDone(`Invitation sent to ${email.trim()}. The account has no access until you activate it and choose its role.`);
      setEmail('');
      setName('');
      await reload();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Invite someone">
      <p className="text-sm mb-3">They receive an email with a link to choose a password.</p>
      <form onSubmit={submit}>
        <ErrorMessage>{error}</ErrorMessage>
        <Notice>{done}</Notice>
        <Field label="Full name" value={name} onChange={setName} autoComplete="off" />
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="off" />
        <Button type="submit" tone="primary" busy={busy}>{busy ? 'Sending…' : 'Send invitation'}</Button>
      </form>
    </Panel>
  );
}

function AccountDetail({ ops, list, account, selfId, reload }: {
  ops: StaffOps; list: StaffList; account: StaffAccount; selfId: string; reload: () => Promise<void>;
}) {
  const [role, setRole] = useState(account.role);
  const linkable = list.therapists.filter((t) => !t.profileId || t.profileId === account.id);
  const [therapistId, setTherapistId] = useState(account.therapist?.id ?? '');
  const isSelf = account.id === selfId;
  return (
    <div>
      <p className="mb-2 text-sm"><a className="underline underline-offset-2" href={href('staff')}>← Staff accounts</a></p>
      <PageTitle>{account.fullName || account.email}</PageTitle>
      <p className="-mt-4 mb-6 text-sm break-all">{account.email} · added {dateTime(account.createdAt)}</p>
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Panel title="Access">
          <p className="text-sm mb-3">
            {account.isActive ? 'This account can sign in to the staff app.' : 'This account has no access to the staff app.'}
            {isSelf && ' This is your own account. There must always be at least one active owner.'}
          </p>
          <ChangeForm reasonLabel="Reason" submitLabel={account.isActive ? 'Remove access' : 'Give access'} onSubmit={async (opts) => {
            await ops.setStaffActive(account.id, !account.isActive, opts.reason ?? '', account.updatedAt);
            await reload();
            return account.isActive ? 'Access removed. It takes effect on their next action.' : 'Access given.';
          }} />
        </Panel>
        <Panel title="Role">
          <ChangeForm reasonLabel="Reason" submitLabel="Change role" onSubmit={async (opts) => {
            await ops.setStaffRole(account.id, role, opts.reason ?? '', account.updatedAt);
            await reload();
            return 'Role changed.';
          }}>
            <SelectField label="Role" value={role} onChange={(v) => setRole(v as StaffAccount['role'])}
              options={(['therapist', 'admin', 'owner'] as const).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
              hint="Owners also manage staff, refunds and payment settings. Admins run the day to day. Therapists see only their own agenda." />
          </ChangeForm>
        </Panel>
        <Panel title="Therapist profile">
          <p className="text-sm mb-3">Linking an account to a therapist profile shows that therapist's appointments in the account's agenda.</p>
          <ChangeForm reasonLabel="Reason" submitLabel="Save link" onSubmit={async (opts) => {
            const current = account.therapist ? list.therapists.find((x) => x.id === account.therapist!.id)! : null;
            if ((current?.id ?? '') === therapistId) return 'No change.';
            // A therapist profile belongs to one account at a time: unlink the old one first.
            if (current) await ops.linkTherapist(current.id, null, opts.reason ?? '', current.updatedAt);
            if (therapistId) {
              const t = list.therapists.find((x) => x.id === therapistId)!;
              await ops.linkTherapist(therapistId, account.id, opts.reason ?? '', t.updatedAt);
            }
            await reload();
            return 'Saved.';
          }}>
            <SelectField label="Therapist profile" value={therapistId} required={false} onChange={setTherapistId}
              options={[{ value: '', label: 'None' }, ...linkable.map((t) => ({ value: t.id, label: `${t.name}${t.isActive ? '' : ' (inactive)'}` }))]} />
          </ChangeForm>
        </Panel>
      </div>
    </div>
  );
}
