import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { messageFor, StaffError } from '../lib/backend';
import {
  fromParagraphs, MAX_UPLOAD_BYTES, toParagraphs, UPLOAD_TYPES,
  type ContentAnnouncement, type ContentFaq, type ContentGalleryItem, type ContentKind, type ContentTestimonial,
  type MediaItem, type SiteContent,
} from '../lib/content';
import type { StaffOps } from '../lib/ops';
import { useLoad } from '../lib/useLoad';
import { href, navigate, type Route } from '../router';
import {
  Badge, Button, CheckboxField, ErrorMessage, Field, LinkAsButton, LoadState, Notice, PageTitle, Panel, SelectField, TextAreaField,
} from '../ui';
import { dateTime } from './common';

// Owner/admin: what the public website shows. Every change goes through the
// staff content functions (role and version checked, recorded in the
// activity log). New items start hidden; showing one is its own step.

const TABS = [
  { id: 'contact', label: 'Contact details' },
  { id: 'faqs', label: 'FAQs' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'testimonials', label: 'Testimonials' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'hero', label: 'Homepage heading' },
  { id: 'pictures', label: 'Picture library' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export const GALLERY_CATEGORIES = [
  { value: 'sanctuary', label: 'Sanctuary' },
  { value: 'treatments', label: 'Treatments' },
  { value: 'therapy', label: 'Therapy' },
];

export function WebsiteScreen({ ops, route }: { ops: StaffOps; route: Route }) {
  const content = useLoad(() => ops.content(), [ops]);
  const [kind, id] = route.path;
  return (
    <LoadState ready={!!content.data} error={content.error} onRetry={content.reload}>
      {() => {
        const c = content.data!;
        const reload = content.reload;
        const isNew = id === 'new';
        if (kind === 'faq') {
          const item = c.faqs.find((f) => f.id === id);
          return isNew || item ? <FaqEditor key={id} ops={ops} item={item ?? null} reload={reload} /> : <Missing tab="faqs" />;
        }
        if (kind === 'gallery') {
          const item = c.gallery.find((g) => g.id === id);
          return isNew || item ? <GalleryEditor key={id} ops={ops} item={item ?? null} media={c.media} reload={reload} /> : <Missing tab="gallery" />;
        }
        if (kind === 'testimonial') {
          const item = c.testimonials.find((t) => t.id === id);
          return isNew || item ? <TestimonialEditor key={id} ops={ops} item={item ?? null} reload={reload} /> : <Missing tab="testimonials" />;
        }
        if (kind === 'announcement') {
          const item = c.announcements.find((a) => a.id === id);
          return isNew || item ? <AnnouncementEditor key={id} ops={ops} item={item ?? null} reload={reload} /> : <Missing tab="announcements" />;
        }
        if (kind === 'picture') {
          const item = c.media.find((m) => m.id === id);
          return item ? <PictureEditor key={id} ops={ops} item={item} reload={reload} /> : <Missing tab="pictures" />;
        }
        const tab = (TABS.find((t) => t.id === route.params.get('tab'))?.id ?? 'contact') as Tab;
        return <WebsiteLists ops={ops} c={c} tab={tab} reload={reload} />;
      }}
    </LoadState>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces

function OnSite({ on }: { on: boolean }) {
  return on ? <Badge tone="bg-emerald-100 text-emerald-900">On the website</Badge> : <Badge tone="bg-slate-200 text-slate-900">Hidden</Badge>;
}

function BackLink({ tab }: { tab: Tab }) {
  const label = TABS.find((t) => t.id === tab)!.label;
  return <p className="mb-2 text-sm"><a className="underline underline-offset-2" href={href('website', [], { tab })}>← Website: {label}</a></p>;
}

function Missing({ tab }: { tab: Tab }) {
  return (
    <div>
      <BackLink tab={tab} />
      <PageTitle>Not found</PageTitle>
      <p className="text-sm">This item no longer exists. Someone may have deleted it.</p>
    </div>
  );
}

/** Runs one change at a time, with its error shown beside the buttons. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/** A form that saves, with "Saved." or the reason it could not. */
function SaveForm({ submitLabel, onSubmit, children }: { submitLabel: string; onSubmit: () => Promise<string | void>; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setDone('');
    try {
      setDone((await onSubmit()) || 'Saved.');
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      {children}
      <ErrorMessage>{error}</ErrorMessage>
      <Notice>{done}</Notice>
      <Button type="submit" tone="primary" busy={busy}>{busy ? 'Saving…' : submitLabel}</Button>
    </form>
  );
}

/** Show on the website / take off, for an item that exists. */
function PublishPanel({ ops, kind, id, published, version, reload, what }: {
  ops: StaffOps; kind: ContentKind; id: string; published: boolean; version: string; reload: () => Promise<void>; what: string;
}) {
  const action = useAction();
  return (
    <Panel title="On the website">
      <p className="text-sm mb-3 flex flex-wrap items-center gap-2"><OnSite on={published} />
        {published ? `Visitors can see this ${what}.` : `Visitors cannot see this ${what} yet.`}</p>
      <ErrorMessage>{action.error}</ErrorMessage>
      <Button tone={published ? 'secondary' : 'primary'} busy={action.busy}
        onClick={() => void action.run(async () => { await ops.setPublished(kind, id, !published, version); await reload(); })}>
        {published ? 'Take off the website' : 'Show on the website'}
      </Button>
    </Panel>
  );
}

/** Permanent removal: only once the item is hidden, and with a reason. */
function DeletePanel({ ops, kind, id, published, version, tab, what }: {
  ops: StaffOps; kind: ContentKind; id: string; published: boolean; version: string; tab: Tab; what: string;
}) {
  const [reason, setReason] = useState('');
  const action = useAction();
  return (
    <Panel title={`Delete this ${what}`}>
      {published ? (
        <p className="text-sm">Take it off the website first. Hidden items can stay in the list for later.</p>
      ) : (
        <form onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await ops.deleteContent(kind, id, reason, version);
            navigate(href('website', [], { tab }));
          });
        }}>
          <p className="text-sm mb-3">Deleting cannot be undone. The activity log keeps a record that it was deleted, and why.</p>
          <Field label="Reason" value={reason} onChange={setReason} autoComplete="off" />
          <ErrorMessage>{action.error}</ErrorMessage>
          <Button type="submit" tone="danger" busy={action.busy} disabled={reason.trim().length < 3}>Delete permanently</Button>
        </form>
      )}
    </Panel>
  );
}

/** A list in website order, with move up / move down. */
function OrderedList<T extends { id: string; isPublished: boolean }>({ ops, kind, items, reload, render, label, editHref, empty }: {
  ops: StaffOps;
  kind: 'faq' | 'gallery' | 'testimonial';
  items: T[];
  reload: () => Promise<void>;
  render: (item: T) => ReactNode;
  /** What the item is called, for the move buttons' labels. */
  label: (item: T) => string;
  editHref: (item: T) => string;
  empty: string;
}) {
  const action = useAction();
  if (!items.length) return <p className="text-sm text-spa-clay">{empty}</p>;
  const move = (index: number, by: -1 | 1) => action.run(async () => {
    const ids = items.map((i) => i.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    await ops.reorder(kind, ids);
    await reload();
  });
  return (
    <div>
      <ErrorMessage>{action.error}</ErrorMessage>
      <ol className="space-y-2">
        {items.map((item, i) => (
          <li key={item.id} className="rounded-lg border border-spa-taupe bg-white p-3 flex flex-wrap items-center gap-3">
            <a href={editHref(item)} className="flex-1 min-w-[12rem] hover:underline underline-offset-2">{render(item)}</a>
            <OnSite on={item.isPublished} />
            <span className="flex gap-1">
              <Button disabled={i === 0 || action.busy} onClick={() => void move(i, -1)} className="px-3" label={`Move up: ${label(item)}`}>
                <span aria-hidden="true">↑</span>
              </Button>
              <Button disabled={i === items.length - 1 || action.busy} onClick={() => void move(i, 1)} className="px-3" label={`Move down: ${label(item)}`}>
                <span aria-hidden="true">↓</span>
              </Button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lists

function WebsiteLists({ ops, c, tab, reload }: { ops: StaffOps; c: SiteContent; tab: Tab; reload: () => Promise<void> }) {
  const add: Partial<Record<Tab, [string, string]>> = {
    faqs: [href('website', ['faq', 'new']), 'Add FAQ'],
    gallery: [href('website', ['gallery', 'new']), 'Add picture'],
    testimonials: [href('website', ['testimonial', 'new']), 'Add testimonial'],
    announcements: [href('website', ['announcement', 'new']), 'Add announcement'],
  };
  const action = add[tab];
  return (
    <div>
      <PageTitle actions={action && <LinkAsButton tone="primary" href={action[0]}>{action[1]}</LinkAsButton>}>Website</PageTitle>
      <p className="text-sm -mt-4 mb-4">What visitors see on the public website. Changes show there straight away; new items stay hidden until you choose to show them.</p>
      <nav aria-label="Website sections" className="mb-6">
        <ul className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <li key={t.id}>
              <a href={href('website', [], { tab: t.id })} aria-current={t.id === tab ? 'page' : undefined}
                className={`inline-block rounded-lg border px-3 py-2 text-sm ${t.id === tab ? 'border-spa-charcoal bg-spa-linen font-medium' : 'border-spa-taupe bg-white'}`}>{t.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'contact' && <ContactForm key={c.contact.updatedAt ?? 'new'} ops={ops} c={c} reload={reload} />}
      {tab === 'hero' && <HeroForm key={c.hero.updatedAt ?? 'new'} ops={ops} c={c} reload={reload} />}

      {tab === 'faqs' && (
        <OrderedList ops={ops} kind="faq" items={c.faqs} reload={reload} editHref={(f) => href('website', ['faq', f.id])}
          empty="No FAQs yet. The website shows its built-in questions until one is added and shown."
          label={(f) => f.question} render={(f) => <span className="font-medium">{f.question}</span>} />
      )}

      {tab === 'gallery' && (
        <OrderedList ops={ops} kind="gallery" items={c.gallery} reload={reload} editHref={(g) => href('website', ['gallery', g.id])}
          empty="No gallery pictures yet." label={(g) => g.title}
          render={(g) => (
            <span className="flex items-center gap-3">
              {g.previewUrl && <img src={g.previewUrl} alt="" className="h-12 w-16 rounded object-cover bg-spa-linen flex-shrink-0" />}
              <span><span className="font-medium block">{g.title}</span>
                <span className="text-xs text-spa-clay">{GALLERY_CATEGORIES.find((x) => x.value === g.category)?.label ?? g.category}</span></span>
            </span>
          )} />
      )}

      {tab === 'testimonials' && (
        <div>
          <Notice>Only show testimonials from real guests who agreed to be quoted. Until at least one is shown, the website shows no testimonials or star ratings.</Notice>
          <OrderedList ops={ops} kind="testimonial" items={c.testimonials} reload={reload} editHref={(t) => href('website', ['testimonial', t.id])}
            empty="No testimonials yet." label={(t) => `testimonial from ${t.authorName}`}
            render={(t) => (
              <span><span className="font-medium">{t.authorName}</span>
                <span className="block text-sm text-spa-clay">{'★'.repeat(t.rating)} · {t.body.slice(0, 80)}{t.body.length > 80 ? '…' : ''}</span></span>
            )} />
        </div>
      )}

      {tab === 'announcements' && (
        c.announcements.length ? (
          <ul className="space-y-2">
            {c.announcements.map((a) => (
              <li key={a.id}>
                <a href={href('website', ['announcement', a.id])} className="rounded-lg border border-spa-taupe bg-white p-3 flex flex-wrap items-center gap-3 hover:border-spa-charcoal">
                  <span className="flex-1 min-w-[12rem]"><span className="font-medium block">{a.title}</span>
                    <span className="text-xs text-spa-clay">{a.kind === 'promotion' ? 'Promotion' : 'Announcement'} · {period(a)}</span></span>
                  <OnSite on={a.isPublished} />
                </a>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-spa-clay">No announcements. Use one for a holiday closure, a new treatment or a seasonal offer.</p>
      )}

      {tab === 'pictures' && <PictureLibrary ops={ops} media={c.media} reload={reload} />}
    </div>
  );
}

function period(a: Pick<ContentAnnouncement, 'startsAt' | 'endsAt'>): string {
  if (!a.startsAt && !a.endsAt) return 'No end date';
  if (a.startsAt && a.endsAt) return `${dateTime(a.startsAt)} to ${dateTime(a.endsAt)}`;
  return a.startsAt ? `From ${dateTime(a.startsAt)}` : `Until ${dateTime(a.endsAt!)}`;
}

// ---------------------------------------------------------------------------
// Contact details and homepage heading

function ContactForm({ ops, c, reload }: { ops: StaffOps; c: SiteContent; reload: () => Promise<void> }) {
  const v = c.contact.value ?? {};
  const [f, setF] = useState({
    address: v.address ?? '', phone: v.phone ?? '', phoneSecondary: v.phone_secondary ?? '', phoneThird: v.phone_third ?? '', email: v.email ?? '', whatsapp: v.whatsapp ?? '',
  });
  const set = (k: keyof typeof f) => (value: string) => setF((x) => ({ ...x, [k]: value }));
  const clean = (s: string) => s.trim() || null;
  return (
    <div className="max-w-xl">
      <Panel title="Contact details">
        <p className="text-sm mb-4">Shown in the website footer and used by the call and WhatsApp buttons. A blank address, second or third phone, or email is hidden; a blank phone or WhatsApp number keeps the website's built-in one.</p>
        <SaveForm submitLabel="Save contact details" onSubmit={async () => {
          await ops.saveContact(c.contact.updatedAt, {
            address: clean(f.address), phone: clean(f.phone), phone_secondary: clean(f.phoneSecondary), phone_third: clean(f.phoneThird), email: clean(f.email), whatsapp: clean(f.whatsapp),
          });
          await reload();
          return 'Contact details saved.';
        }}>
          <TextAreaField label="Address" value={f.address} onChange={set('address')} rows={2} maxLength={300} />
          <Field label="Phone" type="tel" value={f.phone} onChange={set('phone')} required={false} autoComplete="off" hint="With the country code, for example +234 811 859 9365." />
          <Field label="Second phone (optional)" type="tel" value={f.phoneSecondary} onChange={set('phoneSecondary')} required={false} autoComplete="off" />
          <Field label="Third phone (optional)" type="tel" value={f.phoneThird} onChange={set('phoneThird')} required={false} autoComplete="off" />
          <Field label="WhatsApp number" type="tel" value={f.whatsapp} onChange={set('whatsapp')} required={false} autoComplete="off" hint="The number guests message from the website. With the country code." />
          <Field label="Email" type="email" value={f.email} onChange={set('email')} required={false} autoComplete="off" />
        </SaveForm>
      </Panel>
    </div>
  );
}

function HeroForm({ ops, c, reload }: { ops: StaffOps; c: SiteContent; reload: () => Promise<void> }) {
  const v = c.hero.value ?? {};
  const [f, setF] = useState({ heading: v.heading ?? '', subheading: v.subheading ?? '', published: c.hero.isPublished });
  return (
    <div className="max-w-xl">
      <Panel title="Homepage heading">
        <p className="text-sm mb-4">The large heading and the line under it on the first homepage slide. While this is not shown, the website uses its built-in heading.</p>
        <SaveForm submitLabel="Save heading" onSubmit={async () => {
          await ops.saveHero(c.hero.updatedAt, { heading: f.heading.trim() || null, subheading: f.subheading.trim() || null }, f.published);
          await reload();
          return 'Heading saved.';
        }}>
          <Field label="Heading" value={f.heading} onChange={(heading) => setF((x) => ({ ...x, heading }))} required={f.published} autoComplete="off" hint="Up to 120 characters." />
          <TextAreaField label="Line under the heading" value={f.subheading} onChange={(subheading) => setF((x) => ({ ...x, subheading }))} maxLength={300} />
          <CheckboxField label="Show this heading on the website" checked={f.published} onChange={(published) => setF((x) => ({ ...x, published }))} />
        </SaveForm>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editors

function EditorLayout({ tab, title, children }: { tab: Tab; title: string; children: ReactNode }) {
  return (
    <div>
      <BackLink tab={tab} />
      <PageTitle>{title}</PageTitle>
      <div className="grid gap-4 lg:grid-cols-2 items-start">{children}</div>
    </div>
  );
}

function FaqEditor({ ops, item, reload }: { ops: StaffOps; item: ContentFaq | null; reload: () => Promise<void> }) {
  const [question, setQuestion] = useState(item?.question ?? '');
  const [answer, setAnswer] = useState(fromParagraphs(item?.answer ?? []));
  return (
    <EditorLayout tab="faqs" title={item ? 'Edit FAQ' : 'New FAQ'}>
      <Panel title="Question and answer">
        <SaveForm submitLabel={item ? 'Save' : 'Add FAQ'} onSubmit={async () => {
          const saved = await ops.saveFaq(item?.id ?? null, item?.updatedAt ?? null, { question, answer: toParagraphs(answer) });
          await reload();
          if (!item) navigate(href('website', ['faq', saved.id]));
          return item ? 'Saved.' : 'Added. It is hidden until you show it on the website.';
        }}>
          <Field label="Question" value={question} onChange={setQuestion} autoComplete="off" />
          <TextAreaField label="Answer" value={answer} onChange={setAnswer} rows={6} required hint="Plain text. Leave an empty line between paragraphs." />
        </SaveForm>
      </Panel>
      {item && (
        <div className="space-y-4">
          <PublishPanel ops={ops} kind="faq" id={item.id} published={item.isPublished} version={item.updatedAt} reload={reload} what="question" />
          <DeletePanel ops={ops} kind="faq" id={item.id} published={item.isPublished} version={item.updatedAt} tab="faqs" what="FAQ" />
        </div>
      )}
    </EditorLayout>
  );
}

function TestimonialEditor({ ops, item, reload }: { ops: StaffOps; item: ContentTestimonial | null; reload: () => Promise<void> }) {
  const services = useLoad(() => ops.catalogue().then((c) => c.services), [ops]);
  const [f, setF] = useState({
    name: item?.authorName ?? '', location: item?.authorLocation ?? '', body: item?.body ?? '', rating: String(item?.rating ?? 5), serviceId: item?.serviceId ?? '',
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <EditorLayout tab="testimonials" title={item ? 'Edit testimonial' : 'New testimonial'}>
      <Panel title="Guest review">
        <SaveForm submitLabel={item ? 'Save' : 'Add testimonial'} onSubmit={async () => {
          const saved = await ops.saveTestimonial(item?.id ?? null, item?.updatedAt ?? null, {
            authorName: f.name, authorLocation: f.location, body: f.body, rating: Number(f.rating), serviceId: f.serviceId || null,
          });
          await reload();
          if (!item) navigate(href('website', ['testimonial', saved.id]));
          return item ? 'Saved.' : 'Added. It is hidden until you show it on the website.';
        }}>
          <Notice>Use only a real guest's own words, with their permission to show their name.</Notice>
          <Field label="Guest's name as shown" value={f.name} onChange={set('name')} autoComplete="off" hint="For example: Adaeze O." />
          <Field label="Area (optional)" value={f.location} onChange={set('location')} required={false} autoComplete="off" hint="For example: Lekki, Lagos." />
          <TextAreaField label="Review" value={f.body} onChange={set('body')} rows={5} required maxLength={1000} />
          <SelectField label="Stars" value={f.rating} onChange={set('rating')}
            options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} ${n === 1 ? 'star' : 'stars'}` }))} />
          <SelectField label="Treatment (optional)" value={f.serviceId} onChange={set('serviceId')} required={false}
            options={[{ value: '', label: 'None' }, ...(services.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
        </SaveForm>
      </Panel>
      {item && (
        <div className="space-y-4">
          <PublishPanel ops={ops} kind="testimonial" id={item.id} published={item.isPublished} version={item.updatedAt} reload={reload} what="testimonial" />
          <DeletePanel ops={ops} kind="testimonial" id={item.id} published={item.isPublished} version={item.updatedAt} tab="testimonials" what="testimonial" />
        </div>
      )}
    </EditorLayout>
  );
}

/** "2026-12-24T09:00" (Lagos time, as typed) to an instant; Lagos has no daylight saving. */
const fromLocalInput = (value: string) => (value ? `${value}:00+01:00` : null);
const toLocalInput = (instant: string | null) => {
  if (!instant) return '';
  const lagos = new Date(new Date(instant).getTime() + 60 * 60 * 1000);
  return lagos.toISOString().slice(0, 16);
};

function AnnouncementEditor({ ops, item, reload }: { ops: StaffOps; item: ContentAnnouncement | null; reload: () => Promise<void> }) {
  const [f, setF] = useState({
    kind: item?.kind ?? 'announcement', title: item?.title ?? '', body: item?.body ?? '',
    startsAt: toLocalInput(item?.startsAt ?? null), endsAt: toLocalInput(item?.endsAt ?? null),
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <EditorLayout tab="announcements" title={item ? 'Edit announcement' : 'New announcement'}>
      <Panel title="Announcement">
        <SaveForm submitLabel={item ? 'Save' : 'Add announcement'} onSubmit={async () => {
          const saved = await ops.saveAnnouncement(item?.id ?? null, item?.updatedAt ?? null, {
            kind: f.kind as ContentAnnouncement['kind'], title: f.title, body: f.body,
            startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt),
          });
          await reload();
          if (!item) navigate(href('website', ['announcement', saved.id]));
          return item ? 'Saved.' : 'Added. It is hidden until you show it on the website.';
        }}>
          <SelectField label="Type" value={f.kind} onChange={set('kind')}
            options={[{ value: 'announcement', label: 'Announcement' }, { value: 'promotion', label: 'Promotion' }]} />
          <Field label="Title" value={f.title} onChange={set('title')} autoComplete="off" hint="Short: it is shown in a strip just under the homepage banner." />
          <TextAreaField label="More detail (optional)" value={f.body} onChange={set('body')} maxLength={1000} />
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Field label="Show from (optional)" type="datetime-local" value={f.startsAt} onChange={set('startsAt')} required={false} />
            <Field label="Show until (optional)" type="datetime-local" value={f.endsAt} onChange={set('endsAt')} required={false} />
          </div>
          <p className="text-xs text-spa-clay mb-4">Lagos time. Outside these dates it is not shown, even when switched on.</p>
        </SaveForm>
      </Panel>
      {item && (
        <div className="space-y-4">
          <PublishPanel ops={ops} kind="announcement" id={item.id} published={item.isPublished} version={item.updatedAt} reload={reload} what="announcement" />
          <DeletePanel ops={ops} kind="announcement" id={item.id} published={item.isPublished} version={item.updatedAt} tab="announcements" what="announcement" />
        </div>
      )}
    </EditorLayout>
  );
}

function GalleryEditor({ ops, item, media, reload }: { ops: StaffOps; item: ContentGalleryItem | null; media: MediaItem[]; reload: () => Promise<void> }) {
  const [f, setF] = useState({ title: item?.title ?? '', category: item?.category || 'sanctuary' });
  // The picture: an uploaded file (mediaId) or the built-in one it already has (imageUrl).
  const [mediaId, setMediaId] = useState<string | null>(item?.imageMediaId ?? null);
  const builtIn = item?.imageMediaId ? null : item?.imageUrl ?? null;
  const chosen = media.find((m) => m.id === mediaId);
  return (
    <EditorLayout tab="gallery" title={item ? 'Edit gallery picture' : 'New gallery picture'}>
      <Panel title="Details">
        <SaveForm submitLabel={item ? 'Save' : 'Add picture'} onSubmit={async () => {
          if (!mediaId && !builtIn) throw new StaffError('picture_required');
          const saved = await ops.saveGalleryItem(item?.id ?? null, item?.updatedAt ?? null, {
            title: f.title, category: f.category, imageMediaId: mediaId, imageUrl: mediaId ? null : builtIn,
          });
          await reload();
          if (!item) navigate(href('website', ['gallery', saved.id]));
          return item ? 'Saved.' : 'Added. It is hidden until you show it on the website.';
        }}>
          <Field label="Caption" value={f.title} onChange={(title) => setF((x) => ({ ...x, title }))} autoComplete="off" />
          <SelectField label="Gallery filter" value={f.category} onChange={(category) => setF((x) => ({ ...x, category }))} options={GALLERY_CATEGORIES} />
          <div className="mb-4">
            <p className="text-sm font-medium mb-1">Picture</p>
            {chosen ? (
              <img src={chosen.url} alt={chosen.altText} className="w-full max-h-56 object-cover rounded-lg bg-spa-linen" />
            ) : builtIn ? (
              <img src={builtIn} alt="" className="w-full max-h-56 object-cover rounded-lg bg-spa-linen" />
            ) : (
              <p className="text-sm text-spa-clay">Choose a picture from the library, or upload one below.</p>
            )}
          </div>
        </SaveForm>
      </Panel>
      <div className="space-y-4">
        <Panel title="Choose a picture">
          <MediaPicker media={media} value={mediaId} onChange={setMediaId} />
          <UploadForm ops={ops} folder="gallery" onUploaded={async (id) => { await reload(); setMediaId(id); }} />
        </Panel>
        {item && <PublishPanel ops={ops} kind="gallery" id={item.id} published={item.isPublished} version={item.updatedAt} reload={reload} what="picture" />}
        {item && <DeletePanel ops={ops} kind="gallery" id={item.id} published={item.isPublished} version={item.updatedAt} tab="gallery" what="gallery picture" />}
      </div>
    </EditorLayout>
  );
}

function MediaPicker({ media, value, onChange }: { media: MediaItem[]; value: string | null; onChange: (id: string) => void }) {
  const name = useId();
  if (!media.length) return <p className="text-sm text-spa-clay mb-4">The picture library is empty. Upload a picture below.</p>;
  return (
    <fieldset className="mb-4">
      <legend className="text-sm font-medium mb-2">From the library</legend>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {media.map((m) => (
          <label key={m.id} className={`relative cursor-pointer rounded-lg border-2 overflow-hidden ${value === m.id ? 'border-spa-charcoal' : 'border-transparent'}`}>
            <input type="radio" name={name} value={m.id} checked={value === m.id} onChange={() => onChange(m.id)} className="sr-only peer" />
            <img src={m.url} alt={m.altText || 'Picture without a description'} className="h-20 w-full object-cover bg-spa-linen" />
            <span className="absolute inset-0 peer-focus-visible:ring-2 peer-focus-visible:ring-spa-gold peer-focus-visible:ring-inset" aria-hidden="true" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function UploadForm({ ops, folder, onUploaded }: { ops: StaffOps; folder: 'gallery' | 'site'; onUploaded: (id: string) => Promise<void> }) {
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [done, setDone] = useState('');
  const action = useAction();
  const problem = file && !UPLOAD_TYPES.includes(file.type) ? 'Only JPEG, PNG, WebP or AVIF pictures can be uploaded.'
    : file && file.size > MAX_UPLOAD_BYTES ? 'The picture is too large. The limit is 5 MB.' : '';
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!file || problem) return;
      setDone('');
      void action.run(async () => {
        const saved = await ops.uploadMedia(file, folder, alt.trim());
        setFile(null);
        setAlt('');
        setInputKey((k) => k + 1);
        await onUploaded(saved.id);
        setDone('Uploaded and chosen. Save to use it.');
      });
    }}>
      <p className="text-sm font-medium mb-2">Upload a new picture</p>
      <div className="mb-4">
        <label htmlFor={fileId} className="block text-sm mb-1">Picture file</label>
        <input key={inputKey} id={fileId} type="file" accept={UPLOAD_TYPES.join(',')}
          aria-describedby={`${fileId}-hint`} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
        <p id={`${fileId}-hint`} className="mt-1 text-xs text-spa-clay">JPEG, PNG, WebP or AVIF, up to 5 MB.</p>
      </div>
      <Field label="Description for screen readers" value={alt} onChange={setAlt} autoComplete="off"
        hint="What the picture shows, for visitors who cannot see it. For example: Therapist giving a hot stone massage." />
      <ErrorMessage>{problem || action.error}</ErrorMessage>
      <Notice>{done}</Notice>
      <Button type="submit" busy={action.busy} disabled={!file || !!problem}>{action.busy ? 'Uploading…' : 'Upload'}</Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Picture library

function PictureLibrary({ ops, media, reload }: { ops: StaffOps; media: MediaItem[]; reload: () => Promise<void> }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr] items-start">
      <div>
        {media.length ? (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {media.map((m) => (
              <li key={m.id}>
                <a href={href('website', ['picture', m.id])} className="block rounded-lg border border-spa-taupe bg-white overflow-hidden hover:border-spa-charcoal">
                  <img src={m.url} alt="" className="h-28 w-full object-cover bg-spa-linen" />
                  <span className="block p-2 text-xs">
                    <span className="block truncate">{m.altText || 'No description'}</span>
                    <span className="text-spa-clay">{m.uses ? `Used ${m.uses} ${m.uses === 1 ? 'time' : 'times'}` : 'Not used'}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-spa-clay">No uploaded pictures yet. The pictures that came with the website are not listed here.</p>}
      </div>
      <Panel title="Upload">
        <UploadForm ops={ops} folder="site" onUploaded={reload} />
      </Panel>
    </div>
  );
}

function PictureEditor({ ops, item, reload }: { ops: StaffOps; item: MediaItem; reload: () => Promise<void> }) {
  const [alt, setAlt] = useState(item.altText);
  const [reason, setReason] = useState('');
  const remove = useAction();
  return (
    <EditorLayout tab="pictures" title="Picture">
      <Panel title="Preview">
        <img src={item.url} alt={item.altText} className="w-full max-h-80 object-contain rounded-lg bg-spa-linen mb-3" />
        <p className="text-xs text-spa-clay">
          {item.width && item.height ? `${item.width} × ${item.height} pixels · ` : ''}{Math.max(1, Math.round(item.sizeBytes / 1024))} KB · uploaded {dateTime(item.createdAt)}
        </p>
      </Panel>
      <div className="space-y-4">
        <Panel title="Description">
          <SaveForm submitLabel="Save description" onSubmit={async () => {
            await ops.updateMedia(item.id, item.updatedAt, alt.trim());
            await reload();
          }}>
            <Field label="Description for screen readers" value={alt} onChange={setAlt} required={false} autoComplete="off" />
          </SaveForm>
        </Panel>
        <Panel title="Remove from the library">
          {item.uses ? (
            <p className="text-sm">This picture is used {item.uses} {item.uses === 1 ? 'time' : 'times'} on the website. Choose another picture there first.</p>
          ) : (
            <form onSubmit={(e) => {
              e.preventDefault();
              void remove.run(async () => {
                await ops.removeMedia(item.id, reason, item.updatedAt);
                await reload();
                navigate(href('website', [], { tab: 'pictures' }));
              });
            }}>
              <p className="text-sm mb-3">The file is deleted for good.</p>
              <Field label="Reason" value={reason} onChange={setReason} autoComplete="off" />
              <ErrorMessage>{remove.error}</ErrorMessage>
              <Button type="submit" tone="danger" busy={remove.busy} disabled={reason.trim().length < 3}>Remove picture</Button>
            </form>
          )}
        </Panel>
      </div>
    </EditorLayout>
  );
}
