-- Phase 6a: website content security.
--
-- The six website content tables (faqs, testimonials, gallery_items,
-- announcements, site_content, media_assets) still followed their Phase 1
-- rules: owner/admin wrote to them directly, nothing was audited, and guests
-- could read every column and every media row. From here on:
--
--   1. Nobody writes to them directly. Changes go through the staff functions
--      in the next migration (role checked, version checked, audited).
--   2. Guests and signed-in users read only the columns the website shows.
--      Staff account ids, descriptions, demo flags and timestamps are no
--      longer readable through the API; owner/admin get them from
--      staff_content().
--   3. A media row is visible only while something public uses it.
--   4. Every change is recorded in the audit log.
--   5. Staff no longer upload to or delete from Storage directly; the
--      staff-media Edge Function does it after checking the file.
--
-- Public reads of published content are otherwise unchanged. The intake
-- tables are dealt with in Phase 6d.

-- =========================================================================
-- 1. No direct writes; minimum public columns
-- =========================================================================
drop policy "admin manage" on public.faqs;
drop policy "admin manage" on public.testimonials;
drop policy "admin manage" on public.gallery_items;
drop policy "admin manage" on public.announcements;
drop policy "admin manage" on public.site_content;
drop policy "admin manage" on public.media_assets;

revoke select, insert, update, delete on
  public.faqs, public.testimonials, public.gallery_items, public.announcements, public.site_content, public.media_assets
from anon, authenticated;

grant select (id, question, answer, sort_order, is_published)
  on public.faqs to anon, authenticated;
grant select (id, author_name, author_location, body, rating, service_id, sort_order, is_published)
  on public.testimonials to anon, authenticated;
grant select (id, title, category, image_url, image_media_id, sort_order, is_published)
  on public.gallery_items to anon, authenticated;
grant select (id, kind, title, body, starts_at, ends_at, is_published)
  on public.announcements to anon, authenticated;
grant select (key, value, is_published)
  on public.site_content to anon, authenticated;
grant select (id, bucket, path, alt_text, width, height)
  on public.media_assets to anon, authenticated;

-- =========================================================================
-- 2. Media rows: public only while in use
-- =========================================================================
drop policy "public read" on public.media_assets;
create policy "public read in use" on public.media_assets for select to anon, authenticated
  using (
    exists (select 1 from public.gallery_items g where g.image_media_id = media_assets.id and g.is_published)
    or exists (select 1 from public.services s where s.image_media_id = media_assets.id and s.is_active)
    or exists (select 1 from public.therapists t where t.photo_media_id = media_assets.id and t.is_active)
  );

-- A version for edits, as on the other content tables.
alter table public.media_assets add column updated_at timestamptz not null default now();
create trigger set_updated_at before update on public.media_assets
  for each row execute function private.set_updated_at();

-- =========================================================================
-- 3. Audit
-- =========================================================================
create trigger audit_row_change after insert or update or delete on public.faqs
  for each row execute function private.audit_row_change('id');
create trigger audit_row_change after insert or update or delete on public.testimonials
  for each row execute function private.audit_row_change('id');
create trigger audit_row_change after insert or update or delete on public.gallery_items
  for each row execute function private.audit_row_change('id');
create trigger audit_row_change after insert or update or delete on public.announcements
  for each row execute function private.audit_row_change('id');
create trigger audit_row_change after insert or update or delete on public.site_content
  for each row execute function private.audit_row_change('key');
create trigger audit_row_change after insert or update or delete on public.media_assets
  for each row execute function private.audit_row_change('id');

-- A testimonial names a person: the log records that these changed, not the values.
insert into private.audit_personal_columns (entity_type, column_name) values
  ('testimonials', 'author_name'), ('testimonials', 'author_location');

-- =========================================================================
-- 4. Storage: no direct staff access
-- =========================================================================
-- Files are served through the bucket's public URLs, which need no policy.
-- Uploads and deletions are made by the staff-media Edge Function.
drop policy "site-media admin read" on storage.objects;
drop policy "site-media admin insert" on storage.objects;
drop policy "site-media admin update" on storage.objects;
drop policy "site-media admin delete" on storage.objects;
