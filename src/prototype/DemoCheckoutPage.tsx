import { useEffect, useState } from 'react';
import { formatMoney } from '../lib/money';
import { cancelDemoCheckout, completeDemoCheckout, getDemoCheckout, type DemoCheckout, type DemoOutcome } from '../services/paymentService';
import DemoPaymentNotice from '../booking/components/DemoPaymentNotice';
import { browser } from '../booking/navigation';
import PrototypeShell, { Button, ErrorMessage, messageFor, Panel } from './PrototypeShell';

// Plays the payment provider's hosted checkout page while the server uses the
// simulated provider. Choosing an outcome here only tells the simulated
// provider what the guest did; the booking is still decided by the server.

export default function DemoCheckoutPage({ reference }: { reference: string }) {
  const [checkout, setCheckout] = useState<DemoCheckout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [duplicateWebhook, setDuplicateWebhook] = useState(false);

  useEffect(() => {
    getDemoCheckout(reference).then(setCheckout, (err) => setError(messageFor(err)));
  }, [reference]);

  async function act(run: () => Promise<{ returnUrl: string | null }>) {
    setBusy(true);
    setError(null);
    try {
      const { returnUrl } = await run();
      if (returnUrl) browser.assign(returnUrl);
      else setCheckout(await getDemoCheckout(reference));
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }
  const complete = (outcome: DemoOutcome) => act(() => completeDemoCheckout(reference, outcome, duplicateWebhook ? 2 : 1));

  const amount = checkout ? formatMoney(checkout.amountMinor, checkout.currency) : '';
  const paid = checkout?.status === 'success';

  return (
    <PrototypeShell title="Demo checkout" subtitle="Stands in for the payment provider's hosted checkout page.">
      <DemoPaymentNotice />
      <ErrorMessage message={error} />
      {checkout && (
        <Panel>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-spa-charcoal/60">Amount</dt>
            <dd className="text-xl font-semibold">{amount}</dd>
            <dt className="text-spa-charcoal/60">Email</dt>
            <dd>{checkout.email}</dd>
            <dt className="text-spa-charcoal/60">Reference</dt>
            <dd className="break-all font-mono text-xs">{checkout.reference}</dd>
            <dt className="text-spa-charcoal/60">Provider status</dt>
            <dd>{checkout.status === 'abandoned' ? 'not paid' : checkout.status}</dd>
          </dl>
        </Panel>
      )}
      {checkout && !paid && (
        <div className="space-y-3">
          <Button onClick={() => complete('success')} disabled={busy}>
            Pay {amount} (simulate a successful card)
          </Button>
          <Button variant="secondary" onClick={() => complete('decline')} disabled={busy}>
            Simulate a declined card
          </Button>
          <Button variant="secondary" onClick={() => complete('pending')} disabled={busy}>
            Simulate a bank transfer that is still pending
          </Button>
          <Button variant="danger" onClick={() => act(() => cancelDemoCheckout(reference))} disabled={busy}>
            Cancel and return to the site
          </Button>
          <label className="flex items-center gap-2 pt-2 text-xs text-spa-charcoal/70">
            <input type="checkbox" checked={duplicateWebhook} onChange={(e) => setDuplicateWebhook(e.target.checked)} />
            Testing: have the provider deliver its success notification twice
          </label>
        </div>
      )}
      {paid && checkout?.canReturn && (
        <Button onClick={() => act(() => cancelDemoCheckout(reference))} disabled={busy}>
          Already paid — return to the site
        </Button>
      )}
    </PrototypeShell>
  );
}
