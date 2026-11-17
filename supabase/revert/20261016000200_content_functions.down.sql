-- Undoes 20261016000200_content_functions.sql (Phase 6a staff content functions).
--
-- Run only as part of a planned rollback (docs/LAUNCH-RUNBOOK.md, "Undoing
-- Phase 6"), BEFORE 20261016000100_content_security.down.sql, in one
-- transaction. Content rows are kept. Afterwards the staff app's Website
-- section stops working (its functions are gone) until the migration is
-- applied again.

drop function public.staff_remove_media(uuid, text, timestamptz);
drop function public.staff_update_media(uuid, timestamptz, text);
drop function public.staff_register_media(text, bigint, integer, integer, text);
drop function public.staff_delete_content(text, uuid, text, timestamptz);
drop function public.staff_reorder_content(text, uuid[]);
drop function public.staff_set_content_published(text, uuid, boolean, timestamptz);
drop function public.staff_save_site_content(text, timestamptz, jsonb, boolean);
drop function public.staff_save_announcement(uuid, timestamptz, jsonb);
drop function public.staff_save_gallery_item(uuid, timestamptz, jsonb);
drop function public.staff_save_testimonial(uuid, timestamptz, jsonb);
drop function public.staff_save_faq(uuid, timestamptz, jsonb);
drop function public.staff_content();
drop function private.valid_site_content(text, jsonb);
drop function private.content_table(text);
