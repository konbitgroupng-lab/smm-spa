import { useState } from 'react';
import { messageFor } from '../lib/backend';
import type { StaffOps, TransferAwaiting } from '../lib/ops';
import { href } from '../router';
import { Button, ErrorMessage, Field, Notice, Panel } from '../ui';
import { dateTime, money } from './common';

/**
 * Guest bookings waiting for their bank transfer. Check the spa's bank
 * account, then confirm each transfer that has arrived; one that is not
 * confirmed by its deadline is cancelled automatically.
 */
export function TransfersPanel({ ops, transfers, reload, onConfirmed }: {
  ops: StaffOps;
  transfers: TransferAwaiting[];
  reload: () => Promise<void>;
  onConfirmed?: (message: string) => void;
}) {
  return (
    <Panel title="Bank transfers to check">
      {transfers.length ? (
        <>
          <p className="text-sm mb-3">
            Check the bank account for each amount and reference below, then confirm it. A booking not confirmed by its deadline is
            cancelled automatically and its time is offered again.
          </p>
          <ul className="space-y-3">
            {transfers.map((t) => (
              <li key={`${t.appointmentId}-${t.updatedAt}`}>
                <TransferItem ops={ops} t={t} reload={reload} onConfirmed={onConfirmed} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-spa-clay">No bank transfers waiting.</p>
      )}
    </Panel>
  );
}

function TransferItem({ ops, t, reload, onConfirmed }: {
  ops: StaffOps;
  t: TransferAwaiting;
  reload: () => Promise<void>;
  onConfirmed?: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const overdue = new Date(t.dueAt).getTime() <= Date.now();

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await ops.confirmTransfer(t.appointmentId, t.updatedAt, note.trim() || null);
      const message = `Transfer for ${t.reference} confirmed: the booking is confirmed.`;
      setDone(message);
      onConfirmed?.(message);
      await reload();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-spa-taupe bg-white p-3">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{money(t.amountMinor, t.currency)} · reference <span className="font-mono">{t.reference}</span></span>
        <span className={`text-sm ${overdue ? 'text-red-800 font-medium' : 'text-spa-clay'}`}>
          {overdue ? 'Deadline passed' : `Confirm by ${dateTime(t.dueAt)}`}
        </span>
      </p>
      <p className="text-sm">
        {t.contactName}{t.contactPhone && ` · ${t.contactPhone}`} · {t.serviceName}, {dateTime(t.startsAt)}
        {t.amountMinor < t.bookingTotalMinor && ` · deposit of ${money(t.bookingTotalMinor, t.currency)}`}
      </p>
      <p className="text-sm"><a className="underline underline-offset-2" href={href('bookings', [t.appointmentId])}>Open booking</a></p>
      <ErrorMessage>{error}</ErrorMessage>
      <Notice>{done}</Notice>
      {!done && (confirming ? (
        <div className="mt-3 rounded-lg border border-spa-taupe bg-spa-linen p-3">
          <p className="text-sm font-medium mb-2">Have you seen {money(t.amountMinor, t.currency)} with reference {t.reference} arrive in the account?</p>
          <Field label="Note (optional)" value={note} onChange={setNote} required={false} autoComplete="off" hint="For example: seen in the bank app at 10:42." />
          <div className="flex flex-wrap gap-2">
            <Button tone="primary" busy={busy} onClick={() => void confirm()}>{busy ? 'Confirming…' : 'Yes, transfer received'}</Button>
            <Button onClick={() => setConfirming(false)} disabled={busy}>Not yet</Button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <Button tone="primary" onClick={() => setConfirming(true)}>Transfer received</Button>
        </div>
      ))}
    </div>
  );
}
