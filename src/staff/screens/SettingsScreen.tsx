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
    </div>
  );
}
