import { formatDateShort, formatTime, localDateOf } from '../../booking/dates';
import { formatMoney } from '../../lib/money';
import { ACTION_LABEL, FIELD_LABEL, PAYMENT_LABEL, PAYMENT_STATUS_LABEL, REFUND_REASON_LABEL, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE } from '../lib/labels';
import type { AppointmentRow, HistoryEntry } from '../lib/ops';
import { href } from '../router';
import { Badge } from '../ui';

export const timeRange = (startsAt: string, endsAt: string) => `${formatTime(startsAt)}–${formatTime(endsAt)}`;
export const dateTime = (instant: string) => `${formatDateShort(localDateOf(instant))}, ${formatTime(instant)}`;

/** One appointment in a list or calendar column. */
export function AppointmentCard({ appt, showTherapist = true, showDate = false }: {
  appt: AppointmentRow;
  showTherapist?: boolean;
  showDate?: boolean;
}) {
  const faded = appt.status === 'cancelled';
  return (
    <a
      href={href('bookings', [appt.id])}
      className={`block rounded-lg border border-spa-taupe p-3 hover:border-spa-charcoal focus:outline-none focus:ring-2 focus:ring-spa-gold bg-white ${faded ? 'border-dashed' : ''}`}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-medium">
          {showDate && `${formatDateShort(localDateOf(appt.startsAt))} · `}
          {timeRange(appt.startsAt, appt.endsAt)}
        </span>
        <Badge tone={STATUS_TONE[appt.status]}>{STATUS_LABEL[appt.status]}</Badge>
      </span>
      <span className="block text-sm">{appt.serviceName}{showTherapist && ` · ${appt.therapistName}`}</span>
      <span className="block text-sm text-spa-clay">
        {appt.contactName}
        {appt.locationType === 'mobile' ? ' · In-home' : ''}
      </span>
      <span className="mt-1 flex flex-wrap gap-1">
        {appt.source !== 'online' && <Badge>{SOURCE_LABEL[appt.source]}</Badge>}
        <Badge>{PAYMENT_LABEL[appt.paymentState]}</Badge>
        {appt.isDemo && <Badge tone="bg-amber-100 text-amber-900">Demo</Badge>}
      </span>
    </a>
  );
}

function describeValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return dateTime(value);
  if (field === 'status') return STATUS_LABEL[value as keyof typeof STATUS_LABEL] ?? PAYMENT_STATUS_LABEL[String(value)] ?? String(value);
  if (field === 'needs_refund_reason') return REFUND_REASON_LABEL[String(value)] ?? String(value);
  if (LINK_FIELDS.includes(field)) return 'set';
  if (field === 'refund_status' || field === 'settlement' || field === 'role') return String(value).replace(/_/g, ' ');
  if (field.endsWith('_minor') && Number.isFinite(Number(value))) return formatMoney(Number(value));
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/** Derived or technical fields left out of the history (the meaningful change is shown beside them). */
const HIDDEN_FIELDS = ['ends_at', 'blocked_until', 'cancelled_at', 'cancelled_by', 'refundable_minor', 'verified_at', 'paid_currency',
  'provider_transaction_id', 'refund_requested_at', 'refund_processed_at', 'needs_refund_detail', 'hold_id', 'id'];
/** Fields that hold a link to another record: shown as set or removed, not as an id. */
const LINK_FIELDS = ['appointment_id', 'profile_id', 'customer_id', 'service_id', 'dispatch_zone_id', 'created_by', 'photo_media_id'];

/** The audit trail of a record, newest last. Personal fields show only that they changed. */
export function HistoryList({ entries, therapistNames = {} }: { entries: HistoryEntry[]; therapistNames?: Record<string, string> }) {
  if (!entries.length) return <p className="text-sm text-spa-clay">No changes recorded.</p>;
  return (
    <ol className="space-y-3">
      {entries.map((e, i) => (
        <li key={i} className="text-sm border-l-2 border-spa-taupe pl-3">
          <p>
            <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
            {' · '}
            {e.actorKind === 'system' ? 'Booking system' : e.actorName || e.actorRole || 'Staff'}
            {' · '}
            <span className="text-spa-clay">{dateTime(e.occurredAt)}</span>
          </p>
          {e.reason && <p>Reason: {e.reason}</p>}
          {typeof e.context.overridden_rule === 'string' && <p>Booking rule overridden: {String(e.context.overridden_rule).replace(/_/g, ' ')}</p>}
          {Array.isArray(e.context.refund_flagged_payments) && <p>Online payment flagged for refund</p>}
          <ul className="text-spa-clay">
            {Object.entries(e.changes)
              .filter(([field]) => !HIDDEN_FIELDS.includes(field))
              .map(([field, change]) => (
                <li key={field}>
                  {FIELD_LABEL[field] ?? field.replace(/_/g, ' ')}:{' '}
                  {change.changed
                    ? 'changed'
                    : field === 'therapist_id'
                      ? `${therapistNames[String(change.old)] ?? 'previous'} → ${therapistNames[String(change.new)] ?? 'new'}`
                      : `${describeValue(field, change.old)} → ${describeValue(field, change.new)}`}
                </li>
              ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

export const money = formatMoney;
