import { useState } from 'react';
import { messageFor } from '../lib/backend';
import { ENTITY_LABEL } from '../lib/labels';
import type { AuditEntry, StaffOps } from '../lib/ops';
import { useLoad } from '../lib/useLoad';
import { href, navigate, type Route } from '../router';
import { Button, ErrorMessage, LoadState, PageTitle, SelectField } from '../ui';
import { HistoryList } from './common';

const AREAS: { id: string; label: string; types: string[] | null }[] = [
  { id: 'all', label: 'Everything', types: null },
  { id: 'bookings', label: 'Bookings', types: ['appointments'] },
  { id: 'customers', label: 'Customers', types: ['customers'] },
  { id: 'payments', label: 'Payments and refunds', types: ['payments', 'refund_records'] },
  { id: 'schedule', label: 'Schedules and booking rules', types: ['business_hours', 'therapist_schedules', 'therapist_breaks', 'therapist_time_off', 'blackout_dates', 'business_settings'] },
  { id: 'catalogue', label: 'Treatments, therapists and areas', types: ['services', 'service_package_items', 'therapists', 'therapist_services', 'dispatch_zones'] },
  { id: 'staff', label: 'Staff accounts', types: ['profiles'] },
  { id: 'website', label: 'Website content', types: ['faqs', 'testimonials', 'gallery_items', 'announcements', 'site_content', 'media_assets'] },
];
const PAGE = 50;

/** Where an entry's record can be opened. */
function linkFor(e: AuditEntry): string | null {
  if (!e.entityId) return null;
  switch (e.entityType) {
    case 'appointments': return href('bookings', [e.entityId]);
    case 'customers': return href('customers', [e.entityId]);
    case 'payments': return href('payments', [e.entityId]);
    default: return null;
  }
}

/** Owner/admin: everything that changed, who changed it and why. Entries cannot be edited or deleted. */
export function ActivityScreen({ ops, route }: { ops: StaffOps; route: Route }) {
  const area = AREAS.find((a) => a.id === route.params.get('area')) ?? AREAS[0];
  return (
    <div>
      <PageTitle>Activity log</PageTitle>
      <p className="text-sm -mt-4 mb-4">Every change to bookings, customers, payments, schedules, the catalogue, staff accounts and website content, whether made by staff or by the booking system. Nobody can edit or delete these entries. Personal details are shown only as "changed".</p>
      <div className="max-w-sm">
        <SelectField label="Show" value={area.id} onChange={(v) => navigate(href('activity', [], { area: v === 'all' ? null : v }))}
          options={AREAS.map((a) => ({ value: a.id, label: a.label }))} />
      </div>
      <Entries key={area.id} ops={ops} types={area.types} />
    </div>
  );
}

function Entries({ ops, types }: { ops: StaffOps; types: string[] | null }) {
  const first = useLoad(() => ops.auditLog({ entityTypes: types, entityId: null, actionPrefix: null, beforeId: null, limit: PAGE }), [ops, types?.join()]);
  const [older, setOlder] = useState<AuditEntry[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const entries = [...(first.data ?? []), ...older];
  return (
    <LoadState ready={!!first.data} error={first.error} onRetry={first.reload}>
      {() => (
        <>
          {entries.length ? (
            <ol className="space-y-4">
              {entries.map((e) => {
                const link = linkFor(e);
                return (
                  <li key={e.id} className="bg-white rounded-lg border border-spa-taupe p-3">
                    <p className="text-xs text-spa-clay mb-1">
                      {ENTITY_LABEL[e.entityType] ?? e.entityType}
                      {link && <> · <a className="underline underline-offset-2" href={link}>open</a></>}
                    </p>
                    <HistoryList entries={[e]} />
                  </li>
                );
              })}
            </ol>
          ) : <p className="text-sm text-spa-clay">Nothing recorded yet.</p>}
          <ErrorMessage>{error}</ErrorMessage>
          {!done && entries.length >= PAGE && (
            <div className="mt-3"><Button onClick={async () => {
              setError('');
              try {
                const page = await ops.auditLog({ entityTypes: types, entityId: null, actionPrefix: null, beforeId: entries[entries.length - 1].id, limit: PAGE });
                setOlder((x) => [...x, ...page]);
                if (page.length < PAGE) setDone(true);
              } catch (err) {
                setError(messageFor(err));
              }
            }}>Show older</Button></div>
          )}
        </>
      )}
    </LoadState>
  );
}
