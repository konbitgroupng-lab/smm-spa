-- Phase 1: Supabase Storage for approved website media.
--
-- One public bucket, organised by folder:
--   services/    service and package images
--   therapists/  therapist photos
--   gallery/     gallery images
--   site/        other approved website media
--
-- Files are served through public URLs (no select policy needed for that).
-- Only an owner/admin may list, upload, replace or delete them.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-media', 'site-media', true, 5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do nothing;

create policy "site-media admin read" on storage.objects for select to authenticated
  using (bucket_id = 'site-media' and (select private.is_admin()));
create policy "site-media admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-media' and (select private.is_admin()));
create policy "site-media admin update" on storage.objects for update to authenticated
  using (bucket_id = 'site-media' and (select private.is_admin()))
  with check (bucket_id = 'site-media' and (select private.is_admin()));
create policy "site-media admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'site-media' and (select private.is_admin()));
