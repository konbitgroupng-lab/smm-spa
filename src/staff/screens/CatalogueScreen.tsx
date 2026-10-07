import { useState } from 'react';
import { toMinorUnits } from '../../lib/money';
import type { Catalogue, CatalogueService, CatalogueTherapist, CatalogueZone, StaffOps } from '../lib/ops';
import { useLoad } from '../lib/useLoad';
import { href, navigate, type Route } from '../router';
import { Badge, CheckboxField, Field, LinkAsButton, LoadState, Notice, PageTitle, Panel, TextAreaField } from '../ui';
import { ChangeForm } from './ChangeForm';
import { money } from './common';

const TABS = [
  { id: 'services', label: 'Treatments' },
  { id: 'packages', label: 'Packages' },
  { id: 'therapists', label: 'Therapists' },
  { id: 'areas', label: 'In-home areas' },
] as const;

/** Owner/admin: treatments, packages, therapists and in-home areas. */
export function CatalogueScreen({ ops, route }: { ops: StaffOps; route: Route }) {
  const catalogue = useLoad(() => ops.catalogue(), [ops]);
  const [kind, itemId] = route.path;
  return (
    <LoadState ready={!!catalogue.data} error={catalogue.error} onRetry={catalogue.reload}>
      {() => {
        const c = catalogue.data!;
        if (kind === 'service') {
          const existing = c.services.find((s) => s.id === itemId);
          return <ServiceEditor key={itemId} ops={ops} c={c} service={existing ?? null} asPackage={existing ? existing.isPackage : route.params.get('package') === '1'} reload={catalogue.reload} />;
        }
        if (kind === 'therapist') {
          return <TherapistEditor key={itemId} ops={ops} c={c} therapist={c.therapists.find((t) => t.id === itemId) ?? null} reload={catalogue.reload} />;
        }
        if (kind === 'area') {
          return <ZoneEditor key={itemId} ops={ops} zone={c.zones.find((z) => z.id === itemId) ?? null} reload={catalogue.reload} />;
        }
        return <CatalogueLists c={c} tab={route.params.get('tab') ?? 'services'} />;
      }}
    </LoadState>
  );
}

function Active({ on }: { on: boolean }) {
  return on ? <Badge tone="bg-emerald-100 text-emerald-900">Active</Badge> : <Badge tone="bg-slate-200 text-slate-900">Inactive</Badge>;
}

function CatalogueLists({ c, tab }: { c: Catalogue; tab: string }) {
  const current = TABS.find((t) => t.id === tab)?.id ?? 'services';
  const add = {
    services: [href('catalogue', ['service', 'new']), 'Add treatment'],
    packages: [href('catalogue', ['service', 'new'], { package: '1' }), 'Add package'],
    therapists: [href('catalogue', ['therapist', 'new']), 'Add therapist'],
    areas: [href('catalogue', ['area', 'new']), 'Add area'],
  }[current];
  return (
    <div>
      <PageTitle actions={<LinkAsButton tone="primary" href={add[0]}>{add[1]}</LinkAsButton>}>Services &amp; therapists</PageTitle>
      <nav aria-label="Catalogue sections" className="mb-6">
        <ul className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <li key={t.id}>
              <a href={href('catalogue', [], { tab: t.id })} aria-current={t.id === current ? 'page' : undefined}
                className={`inline-block rounded-lg border px-3 py-2 text-sm ${t.id === current ? 'border-spa-charcoal bg-spa-linen font-medium' : 'border-spa-taupe bg-white'}`}>{t.label}</a>
            </li>
          ))}
        </ul>
      </nav>
      {(current === 'services' || current === 'packages') && (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {c.services.filter((s) => s.isPackage === (current === 'packages')).map((s) => (
            <li key={s.id}>
              <a href={href('catalogue', ['service', s.id])} className="block rounded-lg border border-spa-taupe bg-white p-3 hover:border-spa-charcoal">
                <span className="flex justify-between gap-2"><span className="font-medium">{s.name}</span><Active on={s.isActive} /></span>
                <span className="block text-sm">{s.durationMinutes} min · {money(s.priceMinor, s.currency)}{s.bufferMinutes > 0 && ` · ${s.bufferMinutes} min buffer`}</span>
                {s.isPackage && <span className="block text-sm text-spa-clay">{s.items.map((i) => i.name).join(' + ') || 'No treatments yet'}</span>}
                <span className="block text-xs text-spa-clay">{s.futureAppointments} upcoming {s.futureAppointments === 1 ? 'booking' : 'bookings'}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {current === 'therapists' && (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {c.therapists.map((t) => (
            <li key={t.id}>
              <a href={href('catalogue', ['therapist', t.id])} className="block rounded-lg border border-spa-taupe bg-white p-3 hover:border-spa-charcoal">
                <span className="flex justify-between gap-2"><span className="font-medium">{t.displayName}</span><Active on={t.isActive} /></span>
                <span className="block text-sm">{t.title || '—'}</span>
                <span className="block text-xs text-spa-clay">
                  {t.serviceIds.length} {t.serviceIds.length === 1 ? 'treatment' : 'treatments'} · {t.futureAppointments} upcoming · {t.hasAccount ? 'Has a staff account' : 'No staff account'}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {current === 'areas' && (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {c.zones.map((z) => (
            <li key={z.id}>
              <a href={href('catalogue', ['area', z.id])} className="block rounded-lg border border-spa-taupe bg-white p-3 hover:border-spa-charcoal">
                <span className="flex justify-between gap-2"><span className="font-medium">{z.name}</span><Active on={z.isActive} /></span>
                <span className="block text-sm">Travel fee {money(z.feeMinor)}</span>
                <span className="block text-xs text-spa-clay">{z.futureAppointments} upcoming in-home {z.futureAppointments === 1 ? 'booking' : 'bookings'}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const naira = (minor: number | null) => (minor === null ? '' : String(minor / 100));
/** "45,000" or "45000.50" (naira) to kobo; NaN when not a number. */
const kobo = (text: string) => {
  const n = Number(text.replace(/[,\s₦]/g, ''));
  return text.trim() === '' || !Number.isFinite(n) ? Number.NaN : toMinorUnits(n);
};
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function BackLink({ tab }: { tab: string }) {
  return <p className="mb-2 text-sm"><a className="underline underline-offset-2" href={href('catalogue', [], { tab })}>← Services &amp; therapists</a></p>;
}

function ServiceEditor({ ops, c, service, asPackage, reload }: {
  ops: StaffOps; c: Catalogue; service: CatalogueService | null; asPackage: boolean; reload: () => Promise<void>;
}) {
  const [f, setF] = useState({
    name: service?.name ?? '', slug: service?.slug ?? '', category: service?.category ?? (asPackage ? 'Package' : ''),
    description: service?.description ?? '', benefits: (service?.benefits ?? []).join('\n'),
    duration: String(service?.durationMinutes ?? 60), buffer: String(service?.bufferMinutes ?? 15),
    price: naira(service?.priceMinor ?? null), compareAt: naira(service?.compareAtPriceMinor ?? null),
    popular: service?.isPopular ?? false, active: service?.isActive ?? true, sort: String(service?.sortOrder ?? 0),
  });
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const kindWord = asPackage ? 'package' : 'treatment';
  const changesBookedTerms = service && (Number(f.duration) !== service.durationMinutes || Number(f.buffer) !== service.bufferMinutes || kobo(f.price) !== service.priceMinor);
  return (
    <div>
      <BackLink tab={asPackage ? 'packages' : 'services'} />
      <PageTitle>{service ? service.name : `New ${kindWord}`}</PageTitle>
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Panel title={asPackage ? 'Package details' : 'Treatment details'}>
          <ChangeForm submitLabel={service ? 'Save' : `Add ${kindWord}`} onSubmit={async (opts) => {
            const saved = await ops.saveService(service?.id ?? null, service?.updatedAt ?? null, {
              name: f.name, slug: f.slug || slugify(f.name), category: f.category, description: f.description,
              benefits: f.benefits.split('\n').map((b) => b.trim()).filter(Boolean),
              durationMinutes: Number(f.duration), bufferMinutes: Number(f.buffer), priceMinor: kobo(f.price),
              compareAtPriceMinor: f.compareAt.trim() ? kobo(f.compareAt) : null, isPopular: f.popular, isActive: f.active,
              sortOrder: Number(f.sort), isPackage: asPackage,
            }, opts);
            await reload();
            if (!service) navigate(href('catalogue', ['service', saved.id]));
            return 'Saved.';
          }}>
            <Field label="Name" value={f.name} onChange={set('name')} autoComplete="off" />
            <Field label="Web address name" value={f.slug} onChange={set('slug')} required={false} autoComplete="off"
              hint={`Lower-case letters, numbers and hyphens.${service ? '' : ' Left blank, it is made from the name.'}`} />
            <Field label="Category" value={f.category} onChange={set('category')} required={false} autoComplete="off" />
            <div className="grid gap-x-3 grid-cols-2">
              <Field label="Length (minutes)" type="number" value={f.duration} onChange={set('duration')} />
              <Field label="Turnover buffer (minutes)" type="number" value={f.buffer} onChange={set('buffer')} />
              <Field label="Price (₦)" value={f.price} onChange={set('price')} autoComplete="off" />
              <Field label="Was price (₦, optional)" value={f.compareAt} onChange={set('compareAt')} required={false} autoComplete="off" />
            </div>
            <TextAreaField label="Description" value={f.description} onChange={set('description')} maxLength={2000} />
            <TextAreaField label="Benefits (one per line)" value={f.benefits} onChange={set('benefits')} rows={4} />
            <Field label="Display order" type="number" value={f.sort} onChange={set('sort')} hint="Lower numbers are shown first." />
            <CheckboxField label="Popular (highlighted on the website)" checked={f.popular} onChange={set('popular')} />
            <CheckboxField label="Active (offered for booking)" checked={f.active} onChange={set('active')}
              hint="Inactive treatments stay on existing bookings and in history; they are never deleted." />
            {service && changesBookedTerms && service.futureAppointments > 0 && (
              <Notice>{service.futureAppointments} upcoming {service.futureAppointments === 1 ? 'booking keeps its' : 'bookings keep their'} current length, buffer and price; only new bookings use the new values.</Notice>
            )}
          </ChangeForm>
        </Panel>
        {service && asPackage && <PackageItems ops={ops} c={c} pkg={service} reload={reload} />}
      </div>
    </div>
  );
}

function PackageItems({ ops, c, pkg, reload }: { ops: StaffOps; c: Catalogue; pkg: CatalogueService; reload: () => Promise<void> }) {
  const [chosen, setChosen] = useState<string[]>(pkg.items.map((i) => i.serviceId));
  const options = c.services.filter((s) => !s.isPackage);
  return (
    <Panel title="Treatments in this package">
      <p className="text-sm mb-3">The package keeps its own length and price; this list is what it includes.</p>
      <ChangeForm submitLabel="Save contents" onSubmit={async (opts) => {
        // Keep the order in which treatments appear in the catalogue.
        const ordered = options.filter((s) => chosen.includes(s.id)).map((s) => s.id);
        await ops.setPackageItems(pkg.id, ordered, pkg.itemsVersion, opts.reason);
        await reload();
        return 'Package contents saved.';
      }}>
        <fieldset className="mb-4">
          <legend className="sr-only">Treatments</legend>
          {options.map((s) => (
            <CheckboxField key={s.id} label={`${s.name}${s.isActive ? '' : ' (inactive)'}`} checked={chosen.includes(s.id)}
              onChange={(on) => setChosen((list) => (on ? [...list, s.id] : list.filter((x) => x !== s.id)))} />
          ))}
        </fieldset>
      </ChangeForm>
    </Panel>
  );
}

function TherapistEditor({ ops, c, therapist, reload }: { ops: StaffOps; c: Catalogue; therapist: CatalogueTherapist | null; reload: () => Promise<void> }) {
  const [f, setF] = useState({
    name: therapist?.displayName ?? '', title: therapist?.title ?? '', specialty: therapist?.specialty ?? '', bio: therapist?.bio ?? '',
    active: therapist?.isActive ?? true, sort: String(therapist?.sortOrder ?? 0),
  });
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div>
      <BackLink tab="therapists" />
      <PageTitle>{therapist ? therapist.displayName : 'New therapist'}</PageTitle>
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Panel title="Details">
          <ChangeForm submitLabel={therapist ? 'Save' : 'Add therapist'} onSubmit={async (opts) => {
            const saved = await ops.saveTherapist(therapist?.id ?? null, therapist?.updatedAt ?? null, {
              displayName: f.name, title: f.title, specialty: f.specialty, bio: f.bio, isActive: f.active, sortOrder: Number(f.sort),
            }, opts);
            await reload();
            if (!therapist) navigate(href('catalogue', ['therapist', saved.id]));
            return 'Saved.';
          }}>
            <Field label="Name shown to guests" value={f.name} onChange={set('name')} autoComplete="off" />
            <Field label="Title" value={f.title} onChange={set('title')} required={false} autoComplete="off" />
            <Field label="Specialty" value={f.specialty} onChange={set('specialty')} required={false} autoComplete="off" />
            <TextAreaField label="Biography" value={f.bio} onChange={set('bio')} maxLength={2000} />
            <Field label="Display order" type="number" value={f.sort} onChange={set('sort')} />
            <CheckboxField label="Active (can be booked)" checked={f.active} onChange={set('active')}
              hint={therapist && therapist.futureAppointments > 0
                ? `${therapist.futureAppointments} upcoming bookings stay booked if you deactivate; they will be listed under Schedules › Conflicts.`
                : 'Inactive therapists stay on existing bookings and in history.'} />
          </ChangeForm>
        </Panel>
        {therapist && <TherapistServices ops={ops} c={c} therapist={therapist} reload={reload} />}
        {therapist && (
          <Panel title="Working hours and time off">
            <p className="text-sm mb-3">A therapist can be booked only when they have weekly hours and offer the treatment.</p>
            <LinkAsButton href={href('schedules', [], { tab: 'therapists', therapist: therapist.id })}>Edit weekly hours</LinkAsButton>
          </Panel>
        )}
      </div>
    </div>
  );
}

function TherapistServices({ ops, c, therapist, reload }: { ops: StaffOps; c: Catalogue; therapist: CatalogueTherapist; reload: () => Promise<void> }) {
  const [chosen, setChosen] = useState<string[]>(therapist.serviceIds);
  return (
    <Panel title="Treatments offered">
      <ChangeForm submitLabel="Save treatments" onSubmit={async (opts) => {
        await ops.setTherapistServices(therapist.id, chosen, therapist.servicesVersion, opts);
        await reload();
        return 'Treatments saved.';
      }}>
        <fieldset className="mb-4">
          <legend className="sr-only">Treatments offered</legend>
          {c.services.map((s) => (
            <CheckboxField key={s.id} label={`${s.name}${s.isPackage ? ' (package)' : ''}${s.isActive ? '' : ' (inactive)'}`} checked={chosen.includes(s.id)}
              onChange={(on) => setChosen((list) => (on ? [...list, s.id] : list.filter((x) => x !== s.id)))} />
          ))}
        </fieldset>
      </ChangeForm>
    </Panel>
  );
}

function ZoneEditor({ ops, zone, reload }: { ops: StaffOps; zone: CatalogueZone | null; reload: () => Promise<void> }) {
  const [f, setF] = useState({
    name: zone?.name ?? '', key: zone?.key ?? '', fee: naira(zone?.feeMinor ?? null), active: zone?.isActive ?? true, sort: String(zone?.sortOrder ?? 0),
  });
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div>
      <BackLink tab="areas" />
      <PageTitle>{zone ? zone.name : 'New in-home area'}</PageTitle>
      <div className="max-w-xl">
        <Panel title="Area details">
          <ChangeForm submitLabel={zone ? 'Save' : 'Add area'} onSubmit={async (opts) => {
            const saved = await ops.saveZone(zone?.id ?? null, zone?.updatedAt ?? null, {
              name: f.name, key: f.key || slugify(f.name).slice(0, 40), feeMinor: kobo(f.fee), isActive: f.active, sortOrder: Number(f.sort),
            }, opts);
            await reload();
            if (!zone) navigate(href('catalogue', ['area', saved.id]));
            return 'Saved.';
          }}>
            <Field label="Name" value={f.name} onChange={set('name')} autoComplete="off" />
            <Field label="Short name" value={f.key} onChange={set('key')} required={false} autoComplete="off"
              hint={zone ? 'Lower-case letters, numbers and hyphens.' : 'Left blank, it is made from the name.'} />
            <Field label="Travel fee (₦)" value={f.fee} onChange={set('fee')} autoComplete="off"
              hint={zone && zone.futureAppointments > 0 ? 'Upcoming bookings keep the fee they were made with.' : undefined} />
            <Field label="Display order" type="number" value={f.sort} onChange={set('sort')} />
            <CheckboxField label="Active (offered for in-home booking)" checked={f.active} onChange={set('active')}
              hint="Inactive areas stay on existing bookings and in history." />
          </ChangeForm>
        </Panel>
      </div>
    </div>
  );
}
