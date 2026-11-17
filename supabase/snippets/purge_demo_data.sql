-- Removes the demo data before the real launch. Run once, in the SQL editor
-- of the project going live, as one statement (it is a single block).
--
-- BEFORE running:
--   1. Invite the real owner from the staff app and make them owner (the
--      block refuses to run while the only active owner is the demo one).
--   2. Decide about the catalogue (treatments, packages, therapists, in-home
--      areas), set on the KEEP_CATALOGUE line below:
--        true  - the client has confirmed the current ones: they are kept and
--                marked real.
--        false - the real ones have already been entered in the staff app:
--                the demo ones are deleted.
--
-- What it removes: every demo booking with its payments and payment events,
-- the reservations and customers of test bookings (a customer is removed only
-- if every booking they ever had was a demo one), demo staff logins, and any
-- remaining demo website content. The activity log keeps its entries (it
-- cannot be edited). Nothing real is touched.
--
-- Tested in tests/db/purge-demo.test.ts.

do $$
declare
  KEEP_CATALOGUE constant boolean := true;
  v_real_owners integer;
  v_removed jsonb := '{}'::jsonb;
  v_n integer;
begin
  select count(*) into v_real_owners from public.profiles where role = 'owner' and is_active and not is_demo;
  if v_real_owners = 0 then
    raise exception 'No real owner yet. Invite the real owner from the staff app and make them owner first.';
  end if;
  if exists (select 1 from public.refund_records r join public.payments p on p.id = r.payment_id where p.is_demo) then
    raise exception 'A demo payment has a refund record. Refund records cannot be deleted; ask the developer.';
  end if;

  -- Customers whose every booking or reservation was a demo one (test bookings), and demo customers.
  create temporary table purge_customers on commit drop as
    select c.id from public.customers c
     where c.is_demo
        or (exists (select 1 from public.appointments a where a.customer_id = c.id and a.is_demo)
            and not exists (select 1 from public.appointments a where a.customer_id = c.id and not a.is_demo)
            and not exists (select 1 from public.booking_holds h
                              where h.customer_id = c.id
                                and not exists (select 1 from public.payments p where p.hold_id = h.id and p.is_demo)));

  delete from public.payment_events e using public.payments p where e.payment_id = p.id and p.is_demo;
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('payment events', v_n);
  delete from public.payments p
   where p.is_demo or p.appointment_id in (select a.id from public.appointments a where a.is_demo);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('payments', v_n);
  delete from public.appointments where is_demo;
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('bookings', v_n);
  delete from public.booking_holds h where h.customer_id in (select id from purge_customers)
     and not exists (select 1 from public.appointments a where a.hold_id = h.id)
     and not exists (select 1 from public.payments p where p.hold_id = h.id);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('reservations', v_n);
  delete from public.customers where id in (select id from purge_customers);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('customers', v_n);

  -- Demo staff logins (their profiles go with them).
  delete from auth.users u using public.profiles p where p.id = u.id and p.is_demo;
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('staff logins', v_n);

  -- Remaining demo website content.
  delete from public.testimonials where is_demo;
  delete from public.announcements where is_demo;
  delete from public.faqs where is_demo;
  delete from public.gallery_items where is_demo;
  delete from public.site_content where is_demo;
  delete from public.media_assets m where m.is_demo
     and not exists (select 1 from public.gallery_items g where g.image_media_id = m.id)
     and not exists (select 1 from public.services s where s.image_media_id = m.id)
     and not exists (select 1 from public.therapists t where t.photo_media_id = m.id);

  if KEEP_CATALOGUE then
    update public.services set is_demo = false where is_demo;
    update public.therapists set is_demo = false where is_demo;
    update public.dispatch_zones set is_demo = false where is_demo;
    v_removed := v_removed || jsonb_build_object('catalogue', 'kept and marked real');
  else
    delete from public.service_package_items where package_id in (select id from public.services where is_demo);
    delete from public.services where is_demo;
    delete from public.therapists where is_demo;
    delete from public.dispatch_zones where is_demo;
    v_removed := v_removed || jsonb_build_object('catalogue', 'demo entries deleted');
  end if;

  raise notice 'Demo data removed: %', v_removed;
end;
$$;
