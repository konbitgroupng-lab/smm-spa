-- Loads the website's current content into a new project as editable,
-- real (non-demo) content: the seven FAQs, the five gallery pictures and the
-- contact details the site shows. Run once in the SQL editor after
-- purge_demo_data.sql. Safe to run again: each part is skipped if that kind of
-- content already exists. The owner can then change everything in the staff
-- app (Website). Tested in tests/db/purge-demo.test.ts.

begin;

insert into public.faqs (question, answer, sort_order, is_published, is_demo)
select * from (values
  ('How long is a typical massage session?', array['Our standard curated massage sessions are 60 minutes of hands-on treatment. Extended sessions can be arranged upon custom request.'], 1, true, false),
  ('What should I wear during a massage?', array['Wear loose, comfortable clothing that you can easily transition out of. During the massage, you will be professionally draped with white luxury linens at all times, exposing only the specific area being treated.'], 2, true, false),
  ('Do I need a prior appointment?', array['Yes, we operate strictly by appointment to guarantee a serene, uncrowded space for every guest. Please note that booking payment validation secures your time slot.'], 3, true, false),
  ('What is your cancellation or rescheduling policy?', array['We request a minimum of 24 hours notice for any appointment cancellations or rescheduling. Cancellations made within 24 hours of your slot are subject to a standard 35% cancellation fee to compensate our therapists.'], 4, true, false),
  ('Where is your serene sanctuary located?', array['Our boutique physical sanctuary is located at: 9B Oki Lane, Mende, Maryland, Lagos, Nigeria. It is a secure, peaceful spot on the Mainland, easily reached from Ikeja, Yaba, and Gbagada.'], 5, true, false),
  ('What forms of payment do you accept?', array['We accept instant bank transfers and secure online credit/debit card payments. For mobile in-home services, prepayments are required to validate the booking and dispatch therapists.'], 6, true, false),
  ('Are the in-home mobile services the same price?', array['Yes, the base service prices are identical!', 'We charge a nominal transport dispatch fee depending on your exact Lagos location (Lekki, VI, Ikeja, etc.) which is displayed transparently when finalizing your mobile booking.'], 7, true, false)) as v (question, answer, sort_order, is_published, is_demo)
where not exists (select 1 from public.faqs);

insert into public.gallery_items (title, category, image_url, sort_order, is_published, is_demo)
select * from (values
  ('Serene Sanctuary Room', 'sanctuary', '/assets/images/spa_hero_banner_1783345955168.jpg', 1, true, false),
  ('Heated Volcanic Basalt Stones', 'treatments', '/assets/images/hot_stone_massage_1783345970205.jpg', 2, true, false),
  ('Aromatherapy Oils & Rituals', 'therapy', '/assets/images/spa_aromatherapy_1783346057871.jpg', 3, true, false),
  ('Relaxation Lounge', 'sanctuary', '/assets/images/spa_wellness_corner_1783345984514.jpg', 4, true, false),
  ('Professional Swedish Treatment', 'treatments', '/assets/images/swedish_massage_1783346044608.jpg', 5, true, false)) as v (title, category, image_url, sort_order, is_published, is_demo)
where not exists (select 1 from public.gallery_items);

insert into public.site_content (key, value, description, is_published, is_demo)
values ('contact',
        '{"address": "9B Oki Lane, Mende, Maryland, Lagos.", "phone": "+234 811 859 9365", "phone_secondary": "+234 706 667 2648", "email": "ogebestie7@gmail.com", "whatsapp": "+234 811 859 9365"}'::jsonb,
        'Contact details shown in the footer and used by the call and WhatsApp buttons', true, false)
on conflict (key) do nothing;

commit;
