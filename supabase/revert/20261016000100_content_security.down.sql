-- Undoes 20261016000100_content_security.sql (Phase 6a content security).
--
-- Run only as part of a planned rollback (docs/LAUNCH-RUNBOOK.md, "Undoing
-- Phase 6"), AFTER 20261016000200_content_functions.down.sql, in the same
-- transaction. It restores the Phase 1 rules exactly: owner/admin write the
-- content tables directly, guests read every column, all media rows are
-- public, and owner/admin use Storage directly. Content rows and the audit
-- log are kept. The media_assets.updated_at column is dropped.

-- 4. Storage: owner/admin direct access again.
create policy "site-media admin read" on storage.objects for select to authenticated
  using (bucket_id = 'site-media' and (select private.is_admin()));
create policy "site-media admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-media' and (select private.is_admin()));
create policy "site-media admin update" on storage.objects for update to authenticated
  using (bucket_id = 'site-media' and (select private.is_admin()))
  with check (bucket_id = 'site-media' and (select private.is_admin()));
create policy "site-media admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'site-media' and (select private.is_admin()));

-- 3. Audit triggers off.
delete from private.audit_personal_columns
 where entity_type = 'testimonials' and column_name in ('author_name', 'author_location');
drop trigger audit_row_change on public.media_assets;
drop trigger audit_row_change on public.site_content;
drop trigger audit_row_change on public.announcements;
drop trigger audit_row_change on public.gallery_items;
drop trigger audit_row_change on public.testimonials;
drop trigger audit_row_change on public.faqs;

-- 2. Media rows: all public again; no version column.
drop trigger set_updated_at on public.media_assets;
alter table public.media_assets drop column updated_at;
drop policy "public read in use" on public.media_assets;
create policy "public read" on public.media_assets for select to anon, authenticated using (true);

-- 1. Table-wide reads and direct owner/admin writes again.
revoke select (id, question, answer, sort_order, is_published) on public.faqs from anon, authenticated;
revoke select (id, author_name, author_location, body, rating, service_id, sort_order, is_published) on public.testimonials from anon, authenticated;
revoke select (id, title, category, image_url, image_media_id, sort_order, is_published) on public.gallery_items from anon, authenticated;
revoke select (id, kind, title, body, starts_at, ends_at, is_published) on public.announcements from anon, authenticated;
revoke select (key, value, is_published) on public.site_content from anon, authenticated;
revoke select (id, bucket, path, alt_text, width, height) on public.media_assets from anon, authenticated;

grant select on
  public.faqs, public.testimonials, public.gallery_items, public.announcements, public.site_content, public.media_assets
to anon, authenticated;
grant select, insert, update, delete on
  public.faqs, public.testimonials, public.gallery_items, public.announcements, public.site_content, public.media_assets
to authenticated;

create policy "admin manage" on public.faqs for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin manage" on public.testimonials for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin manage" on public.gallery_items for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin manage" on public.announcements for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin manage" on public.site_content for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin manage" on public.media_assets for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
