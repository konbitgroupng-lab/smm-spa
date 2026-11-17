import { useState } from 'react';
import type { StaffRole } from '../lib/backend';
import type { Settings, StaffOps } from '../lib/ops';
import { useLoad } from '../lib/useLoad';
import { href } from '../router';
import { Badge, CheckboxField, ChoiceGroup, Field, LoadState, PageTitle, Panel } from '../ui';
import { ChangeForm } from './ChangeForm';

/** Business name (owner/admin) and payment settings (owner only). */
export function SettingsScreen({ ops, role }: { ops: StaffOps; role: StaffRole }) {
  const settings = useLoad(() => ops.settings(), [ops]);
  return (
    <div>
      <PageTitle>Settings</PageTitle>
      <LoadState ready={!!settings.data} error={settings.error} onRetry={settings.reload}>
        {() => <SettingsPanels ops={ops} s={settings.data!} role={role} reload={settings.reload} />}
      </LoadState>
    </div>
  );
}

function SettingsPanels({ ops, s, role, reload }: { ops: StaffOps; s: Settings; role: StaffRole; reload: () => Promise<void> }) {
  const [name, setName] = useState(s.businessName);
  const [online, setOnline] = useState(s.onlinePaymentEnabled);
  const [mode, setMode] = useState<'full' | 'deposit'>(s.paymentMode);
  const [deposit, setDeposit] = useState(String(s.depositPercent));
  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <Panel title="Business">
        <ChangeForm reasonLabel="Reason" submitLabel="Save business name" onSubmit={async (opts) => {
          await ops.updateBusinessName(s.updatedAt, name, opts.reason ?? '');
          await reload();
          return 'Business name saved.';
        }}>
          <Field label="Business name" value={name} onChange={setName} autoComplete="off" />
        </ChangeForm>
        <p className="text-sm mt-4">Timezone {s.timezone}, currency {s.currency}. Booking rules are under <a className="underline underline-offset-2" href={href('schedules', [], { tab: 'rules' })}>Schedules › Booking rules</a>.</p>
      </Panel>

      <Panel title="Online payment">
        {role === 'owner' ? (
          <ChangeForm reasonLabel="Reason" submitLabel="Save payment settings" onSubmit={async (opts) => {
            await ops.updatePaymentSettings(s.updatedAt, { onlinePaymentEnabled: online, paymentMode: mode, depositPercent: Number(deposit) }, opts.reason ?? '');
            await reload();
            return 'Payment settings saved.';
          }}>
            <CheckboxField label="Take bookings with online payment" checked={online} onChange={setOnline}
              hint="When off, the website shows that online booking is unavailable, with WhatsApp and phone details." />
            <ChoiceGroup<'full' | 'deposit'> label="Guests pay" value={mode} onChange={setMode}
              options={[{ value: 'full', label: 'The full price' }, { value: 'deposit', label: 'A deposit' }]} />
            {mode === 'deposit' && <Field label="Deposit (% of the price)" type="number" value={deposit} onChange={setDeposit} />}
          </ChangeForm>
        ) : (
          <dl className="text-sm grid grid-cols-[10rem_1fr] gap-y-1">
            <dt className="text-spa-clay">Online payment</dt><dd>{s.onlinePaymentEnabled ? 'On' : 'Off'}</dd>
            <dt className="text-spa-clay">Guests pay</dt><dd>{s.paymentMode === 'deposit' ? `A ${s.depositPercent}% deposit` : 'The full price'}</dd>
            <dd className="col-span-2 text-spa-clay mt-2">Only the owner can change payment settings.</dd>
          </dl>
        )}
        <div className="mt-4 rounded-lg border border-spa-taupe bg-spa-linen p-3 text-sm">
          <p className="font-medium mb-1">Demo payments {s.allowDemoPayments ? <Badge tone="bg-amber-100 text-amber-900">Allowed</Badge> : <Badge>Not allowed</Badge>}</p>
          <p>This safety switch is set by the developer in the database and cannot be changed from the staff app. Payment provider keys are never shown or entered here.</p>
        </div>
      </Panel>

      <TransferSettings ops={ops} s={s} role={role} reload={reload} />
    </div>
  );
}

/** Direct bank transfer: the account guests pay into (owner changes it; admins see it). */
function TransferSettings({ ops, s, role, reload }: { ops: StaffOps; s: Settings; role: StaffRole; reload: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(s.transferEnabled);
  const [bank, setBank] = useState(s.bankName ?? '');
  const [number, setNumber] = useState(s.bankAccountNumber ?? '');
  const [holder, setHolder] = useState(s.bankAccountName ?? '');
  const hours = s.transferHoldMinutes % 60 === 0 ? `${s.transferHoldMinutes / 60} hours` : `${s.transferHoldMinutes} minutes`;
  return (
    <Panel title="Bank transfer">
      <p className="text-sm mb-3">
        Guests can choose to pay by transfer into this account. Their time is reserved for {hours}; confirm each transfer under
        Today › Bank transfers to check. Unconfirmed ones are cancelled automatically.
      </p>
      {role === 'owner' ? (
        <ChangeForm key={s.updatedAt} reasonLabel="Reason" submitLabel="Save bank transfer details" onSubmit={async (opts) => {
          await ops.updateTransferSettings(s.updatedAt, { enabled, bankName: bank, accountNumber: number, accountName: holder }, opts.reason ?? '');
          await reload();
          return 'Bank transfer details saved.';
        }}>
          <CheckboxField label="Offer bank transfer to guests" checked={enabled} onChange={setEnabled}
            hint="Shown at the last booking step, next to online payment (or on its own when online payment is off)." />
          <Field label="Bank" value={bank} onChange={setBank} required={enabled} autoComplete="off" />
          <Field label="Account number" value={number} onChange={setNumber} required={enabled} autoComplete="off" hint="Digits only, for example 0123456789." />
          <Field label="Account name" value={holder} onChange={setHolder} required={enabled} autoComplete="off" hint="Exactly as the bank shows it to the guest." />
        </ChangeForm>
      ) : (
        <dl className="text-sm grid grid-cols-[10rem_1fr] gap-y-1">
          <dt className="text-spa-clay">Bank transfer</dt><dd>{s.transferEnabled ? 'Offered' : 'Not offered'}</dd>
          <dt className="text-spa-clay">Bank</dt><dd>{s.bankName ?? '—'}</dd>
          <dt className="text-spa-clay">Account number</dt><dd>{s.bankAccountNumber ?? '—'}</dd>
          <dt className="text-spa-clay">Account name</dt><dd>{s.bankAccountName ?? '—'}</dd>
          <dd className="col-span-2 text-spa-clay mt-2">Only the owner can change the bank details.</dd>
        </dl>
      )}
    </Panel>
  );
}
