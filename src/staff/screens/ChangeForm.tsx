import { useState, type FormEvent, type ReactNode } from 'react';
import { messageFor } from '../lib/backend';
import { CONFLICT_LABEL } from '../lib/labels';
import { conflictsOf, type ChangeOptions, type ConflictSummary } from '../lib/ops';
import { href } from '../router';
import { Button, CheckboxField, ErrorMessage, Field, Notice } from '../ui';
import { dateTime } from './common';

export function reasonsText(reasons: string[]): string {
  return reasons.map((r) => CONFLICT_LABEL[r] ?? r.replace(/_/g, ' ')).join('; ');
}

/** The bookings a change affects. They are never changed or cancelled. */
export function ConflictList({ summary }: { summary: ConflictSummary }) {
  return (
    <div>
      {summary.appointments.length > 0 && (
        <ul className="space-y-1 text-sm mb-2">
          {summary.appointments.map((a) => (
            <li key={a.id}>
              <a className="underline underline-offset-2" href={href('bookings', [a.id])}>{dateTime(a.startsAt)} · {a.reference}</a>
              {' · '}{a.serviceName} · {a.therapistName}{a.contactName && ` · ${a.contactName}`}
              <br /><span className="text-spa-clay">{reasonsText(a.reasons)}</span>
            </li>
          ))}
        </ul>
      )}
      {summary.reservations > 0 && (
        <p className="text-sm mb-2">
          {summary.reservations === 1 ? '1 guest is' : `${summary.reservations} guests are`} part-way through booking an affected time.
          If they pay, the payment will be flagged for a refund instead of creating a booking.
        </p>
      )}
    </div>
  );
}

/**
 * A schedule or catalogue form. If the server says the change would affect
 * existing bookings, they are listed and the change can be confirmed with a
 * reason: the bookings stay exactly as they are and appear under Conflicts.
 */
export function ChangeForm({ submitLabel, onSubmit, children, reasonLabel = 'Reason (optional)' }: {
  submitLabel: string;
  onSubmit: (opts: ChangeOptions) => Promise<string | void>;
  children?: ReactNode;
  reasonLabel?: string;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [pending, setPending] = useState<ConflictSummary | null>(null);
  const [accepted, setAccepted] = useState(false);

  async function run(confirm: boolean) {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const message = await onSubmit({ reason: reason.trim() || null, confirm });
      setPending(null);
      setAccepted(false);
      setReason('');
      setDone(message || 'Saved.');
    } catch (err) {
      const summary = conflictsOf(err);
      if (summary) {
        setPending(summary);
        setAccepted(false);
      } else {
        setError(messageFor(err));
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(false);
  }

  return (
    <form onSubmit={submit}>
      {children}
      <Field label={reasonLabel} value={reason} onChange={setReason} required={false} autoComplete="off" />
      <ErrorMessage>{error}</ErrorMessage>
      <Notice>{done}</Notice>
      {pending ? (
        <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="font-medium text-sm mb-2">This change affects existing bookings</p>
          <ConflictList summary={pending} />
          <p className="text-xs text-spa-clay mb-3">Nothing is cancelled or moved. Contact the guests if needed, or reschedule them.</p>
          <CheckboxField
            label="Save anyway: keep these bookings as they are and list them under Conflicts"
            checked={accepted}
            onChange={setAccepted}
            hint="A reason is required, and it is recorded."
          />
          <div className="flex flex-wrap gap-2">
            <Button tone="primary" busy={busy} disabled={!accepted || reason.trim().length < 3} onClick={() => void run(true)}>Save anyway</Button>
            <Button onClick={() => setPending(null)}>Go back</Button>
          </div>
        </div>
      ) : (
        <Button type="submit" tone="primary" busy={busy}>{busy ? 'Saving…' : submitLabel}</Button>
      )}
    </form>
  );
}
