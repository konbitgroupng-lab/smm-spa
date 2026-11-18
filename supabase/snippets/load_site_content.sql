-- Loads the website's current content into a new project as editable,
-- real (non-demo) content: the seven FAQs, the five gallery pictures, the six
-- Google reviews and the contact details the site shows. Run once in the SQL editor after
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
  ('Heated Volcanic Basalt Stones', 'treatments', '/assets/images/gallery-hot-stones.jpg', 2, true, false),
  ('Aromatherapy Oils & Rituals', 'therapy', '/assets/images/spa_aromatherapy_1783346057871.jpg', 3, true, false),
  ('Relaxation Lounge', 'sanctuary', '/assets/images/spa_wellness_corner_1783345984514.jpg', 4, true, false),
  ('Professional Swedish Treatment', 'treatments', '/assets/images/swedish_massage_1783346044608.jpg', 5, true, false)) as v (title, category, image_url, sort_order, is_published, is_demo)
where not exists (select 1 from public.gallery_items);

-- The spa's real Google reviews (Google Business listing, copied word for word
-- on 19 November 2026). Six five-star reviews; names as first name and surname initial.
insert into public.testimonials (author_name, author_location, body, rating, sort_order, is_published, is_demo)
select * from (values
  ('Sikiru O.', 'Google review', $r$I had an outstanding experience with their service. From the moment I made contact, I was impressed by the professionalism and attention to detail displayed by the therapist. Every interaction felt seamless, and their commitment to providing top-notch service was evident throughout the entire process. They truly went above and beyond to ensure my needs were met, leaving me thoroughly satisfied and grateful.$r$, 5, 1, true, false),
  ('David A.', 'Google review', $r$I've had massage sessions a couple of times but this is the best so far.

She's jovial and super considerate, and always out to give the best experience.

Thank you✨$r$, 5, 2, true, false),
  ('Praizethompson', 'Google review', $r$I decides to give her a trial and trust me in my years of several sessions with a masseuse this was the best I ever had$r$, 5, 3, true, false),
  ('Feyisayo S.', 'Google review', $r$Her massage session is a very relaxing, she is very good on a scale of 100% and very friendly also✅$r$, 5, 4, true, false),
  ('Ezenagu E.', 'Google review', $r$Highly professional, good at her job and friendly too, she is one d best around.$r$, 5, 5, true, false),
  ('Emmanuel I.', 'Google review', $r$Thank you oge ,I have great experience from ur beautiful ladies so many times n I will hide it worthy every single money I paid for services God bless you immensely one love ❤️‍🔥❤️‍🔥❤️‍🔥❤️‍🔥 ❤️‍🔥❤️‍🔥$r$, 5, 6, true, false)) as v (author_name, author_location, body, rating, sort_order, is_published, is_demo)
where not exists (select 1 from public.testimonials);

insert into public.site_content (key, value, description, is_published, is_demo)
values ('contact',
        '{"address": "9B Oki Lane, Mende, Maryland, Lagos.", "phone": "+234 811 859 9365", "phone_secondary": "+234 913 533 0351", "phone_third": "+234 701 090 0261", "email": "ogebestie7@gmail.com", "whatsapp": "+234 811 859 9365"}'::jsonb,
        'Contact details shown in the footer and used by the call and WhatsApp buttons', true, false)
on conflict (key) do nothing;

commit;
