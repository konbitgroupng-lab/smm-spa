-- Removes every demo row. Run once in the SQL editor before launch, after the
-- client's verified services, therapists and content have been entered.
-- Demo staff logins are removed separately: delete those users in
-- Authentication > Users (their profiles cascade).

begin;

delete from public.payments where is_demo;
delete from public.appointments where is_demo;
delete from public.customers where is_demo;
delete from public.testimonials where is_demo;
delete from public.faqs where is_demo;
delete from public.gallery_items where is_demo;
delete from public.announcements where is_demo;
delete from public.site_content where is_demo;
delete from public.media_assets where is_demo;
delete from public.dispatch_zones where is_demo;
delete from public.therapists where is_demo;
delete from public.service_package_items
 where package_id in (select id from public.services where is_demo);
delete from public.services where is_demo;

commit;
