import { useState, type FormEvent } from 'react';
import { messageFor } from '../lib/backend';
import { PAYMENT_LABEL, SETTLEMENT_LABEL, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE } from '../lib/labels';
import type { CustomerDetail, CustomerRow, StaffOps } from '../lib/ops';
import { useLoad } from '../lib/useLoad';
import { href, navigate, type Route } from '../router';
import { Badge, Button, ErrorMessage, Field, LoadState, Notice, PageTitle, Panel, TextAreaField } from '../ui';
import { dateTime, money } from './common';

const PAGE = 25;

/** Owner/admin: the customer directory, with search. */
export function CustomersScreen({ ops, route }: { ops: StaffOps; route: Route }) {
  const query = route.params.get('q') ?? '';
  const [search, setSearch] = useState(query);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <PageTitle actions={<Button tone="primary" onClick={() => setAdding((a) => !a)}>{adding ? 'Close' : 'Add customer'}</Button>}>Customers</PageTitle>
      {adding && (
        <div className="mb-6"><Panel title="New customer"><CustomerForm ops={ops} onSaved={(id) => navigate(href('customers', [id]))} /></Panel></div>
      )}
      <form role="search" className="flex flex-wrap gap-2 items-end mb-4" onSubmit={(e) => { e.preventDefault(); navigate(href('customers', [], { q: search.trim() || null })); }}>
        <div className="flex-1 min-w-[14rem]"><Field label="Search by name, email or phone" value={search} onChange={setSearch} required={false} autoComplete="off" /></div>
        <div className="mb-4"><Button type="submit">Search</Button></div>
      </form>
      <CustomerList key={query} ops={ops} query={query} />
    </div>
  );
}

/** The results for one search; "Show more" adds the next page. */
function CustomerList({ ops, query }: { ops: StaffOps; query: string }) {
  const first = useLoad(() => ops.customers(query, PAGE, 0), [ops, query]);
  const [extra, setExtra] = useState<CustomerRow[]>([]);
  const [moreError, setMoreError] = useState('');
  const rows = [...(first.data?.rows ?? []), ...extra];

  async function more() {
    setMoreError('');
    try {
      const page = await ops.customers(query, PAGE, rows.length);
      setExtra((r) => [...r, ...page.rows]);
    } catch (err) {
      setMoreError(messageFor(err));
    }
  }

  return (
    <div>
      <LoadState ready={!!first.data} error={first.error} onRetry={first.reload}>
        {() => (
          <>
            <p className="text-sm mb-3" aria-live="polite">{first.data!.total} {first.data!.total === 1 ? 'customer' : 'customers'}{query && ` matching "${query}"`}</p>
            {rows.length > 0 && (
              <div className="overflow-x-auto bg-white rounded-xl border border-spa-taupe">
                <table className="w-full text-sm">
                  <thead className="text-left bg-spa-linen">
                    <tr>
                      <th scope="col" className="px-3 py-2">Name</th>
                      <th scope="col" className="px-3 py-2">Phone</th>
                      <th scope="col" className="px-3 py-2 hidden md:table-cell">Email</th>
                      <th scope="col" className="px-3 py-2">Bookings</th>
                      <th scope="col" className="px-3 py-2 hidden md:table-cell">Next visit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id} className="border-t border-spa-taupe">
                        <td className="px-3 py-2"><a className="underline underline-offset-2" href={href('customers', [c.id])}>{c.fullName}</a>{c.isDemo && ' (demo)'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{c.phone ?? '—'}</td>
                        <td className="px-3 py-2 hidden md:table-cell break-all">{c.email ?? '—'}</td>
                        <td className="px-3 py-2">{c.appointmentCount}</td>
                        <td className="px-3 py-2 hidden md:table-cell">{c.nextVisit ? dateTime(c.nextVisit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <ErrorMessage>{moreError}</ErrorMessage>
            {rows.length < first.data!.total && <div className="mt-3"><Button onClick={() => void more()}>Show more</Button></div>}
          </>
        )}
      </LoadState>
    </div>
  );
}

/** Customer master record: create (no `customer`) or edit with its version. */
function CustomerForm({ ops, customer, onSaved }: {
  ops: StaffOps;
  customer?: CustomerDetail['customer'];
  onSaved: (id: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(customer?.fullName ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [notes, setNotes] = useState(customer?.staffNotes ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const input = { fullName: name, email: email || null, phone: phone || null, staffNotes: notes || null };
    try {
      if (customer) {
        await ops.updateCustomer(customer.id, customer.updatedAt, { ...input, reason: reason || null });
        await onSaved(customer.id);
      } else {
        const created = await ops.createCustomer(input);
        await onSaved(created.id);
      }
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <ErrorMessage>{error}</ErrorMessage>
      <Field label="Full name" value={name} onChange={setName} autoComplete="off" />
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Phone" type="tel" value={phone} onChange={setPhone} required={false} autoComplete="off" />
        <Field label="Email" type="email" value={email} onChange={setEmail} required={false} autoComplete="off" />
      </div>
      <TextAreaField label="Staff notes" value={notes} onChange={setNotes} maxLength={2000} hint="For owner and admin only. Never shown to therapists." />
      {customer && <Field label="Reason (optional)" value={reason} onChange={setReason} required={false} />}
      <Button type="submit" tone="primary" busy={busy}>{busy ? 'Saving…' : customer ? 'Save customer record' : 'Add customer'}</Button>
    </form>
  );
}

/** Owner/admin: one customer's master record and booking history. */
export function CustomerDetailScreen({ ops, id }: { ops: StaffOps; id: string }) {
  const detail = useLoad(() => ops.customerDetail(id), [ops, id]);
  const [notice, setNotice] = useState('');
  return (
    <div>
      <p className="mb-2 text-sm"><a className="underline underline-offset-2" href={href('customers')}>← All customers</a></p>
      <LoadState ready={!!detail.data} error={detail.error} onRetry={detail.reload}>
        {() => {
          const { customer, appointments } = detail.data!;
          return (
            <>
              <PageTitle>{customer.fullName}</PageTitle>
              <Notice>{notice}</Notice>
              <div className="grid gap-4 lg:grid-cols-2 items-start">
                <Panel title="Customer record">
                  <p className="text-xs text-spa-clay mb-3">Changes here update this record only. Each booking keeps the contact details given for it.</p>
                  <CustomerForm key={customer.updatedAt} ops={ops} customer={customer} onSaved={async () => { await detail.reload(); setNotice('Customer record saved.'); }} />
                </Panel>
                <Panel title={`Bookings (${appointments.length})`}>
                  {appointments.length ? (
                    <ul className="space-y-2">
                      {appointments.map((a) => (
                        <li key={a.id} className="text-sm border-b border-spa-taupe pb-2">
                          <a className="underline underline-offset-2 font-medium" href={href('bookings', [a.id])}>{dateTime(a.startsAt)}</a>
                          {' · '}{a.serviceName} · {a.therapistName}
                          <div className="flex flex-wrap gap-1 mt-1">
                            <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                            <Badge>{SOURCE_LABEL[a.source]}</Badge>
                            <Badge>{a.source === 'online' ? PAYMENT_LABEL[a.paymentState] : SETTLEMENT_LABEL[a.settlement]}</Badge>
                          </div>
                          <p className="text-spa-clay">Contact given: {a.contactName ?? '—'}{a.contactPhone && ` · ${a.contactPhone}`} · {money(a.totalMinor, a.currency)}</p>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-spa-clay">No bookings yet.</p>}
                </Panel>
              </div>
            </>
          );
        }}
      </LoadState>
    </div>
  );
}
