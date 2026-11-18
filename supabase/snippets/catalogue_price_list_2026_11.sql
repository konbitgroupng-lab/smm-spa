-- Brings the bookable catalogue in line with the client's price list
-- (November 2026; see src/content/priceList.ts and src/data.ts, which show the
-- same six treatments on the homepage). Run once in the SQL editor, as one
-- transaction. Safe to run again.
--
--   * Prices, names and descriptions as on the price list; these six are the
--     client's confirmed menu (no longer demo).
--   * New: Aromatherapy Massage and Hammam Moroccan Body Scrub.
--   * Switched off (not offered): Nuru Massage, Thai Massage and the three
--     invented packages. Switched off, not deleted: existing bookings and the
--     history keep them, and nothing new can be booked.
--   * Couples and four-hands massages are not added: they need two therapists
--     at once, which online booking cannot reserve, so they are booked on
--     WhatsApp.
--
-- Tested in tests/services/catalog.test.ts.

begin;

insert into public.services (slug, name, category, description, benefits, duration_minutes, price_minor, image_url, sort_order, is_active, is_demo) values
  ('swedish', 'Swedish Massage', 'Relaxation',
   'A classic relaxation therapy utilizing long, gliding strokes and gentle kneading to melt away daily stress and tension.',
   array['Promotes deep body relaxation & stress relief', 'Improves blood circulation & lymph flow', 'Relieves light muscle tension & joint stiffness', 'Alleviates mild headaches & migraines', 'Boosts overall well-being & enhances deep sleep'],
   60, 3300000, '/assets/images/swedish_massage_1783346044608.jpg', 1, true, false),
  ('deep-tissue', 'Deep Tissue Massage', 'Therapeutic',
   'Designed to target deep layers of muscle and connective tissue. Highly beneficial for chronic muscle tightness, soreness, and physical fatigue.',
   array['Alleviates chronic muscle pain & heavy tension', 'Improves posture, mobility, & overall range of motion', 'Works out painful knots & tight spots', 'Supports muscle recovery after exercise', 'Provides deep, lasting stress relief'],
   60, 3500000, '/assets/images/deep-tissue-massage.jpg', 2, true, false),
  ('hot-stone', 'Hot Stone Therapy', 'Sensory',
   'Combining smooth, heated basalt stones with traditional massage strokes to carry deep warmth into your muscles and melt away tension.',
   array['Relieves intense muscle tension & discomfort', 'Soothing warmth improves blood circulation', 'Eases restlessness, anxiety & mental fatigue', 'Loosens tight muscles before deeper work', 'Leaves you calm, warm and deeply rested'],
   60, 4000000, '/assets/images/hot_stone_massage_1783345970205.jpg', 3, true, false),
  ('aromatherapy', 'Aromatherapy Massage', 'Relaxation',
   'A soothing full-body massage with blended essential oils, chosen to help you relax, breathe deeply and let go of the day.',
   array['Calming essential oils for body and mind', 'Gentle, flowing strokes for deep relaxation', 'Helps ease stress and improve sleep', 'Nourishes and softens the skin', 'Leaves a light, lasting sense of calm'],
   60, 4000000, '/assets/images/aromatherapy-massage.jpg', 4, true, false),
  ('moroccan-scrub', 'Hammam Moroccan Body Scrub', 'Body Treatment',
   'A deep, Hammam-style exfoliating body scrub with a sauna session before and after the treatment, for smooth, glowing skin. ₦70,000 for an in-home visit.',
   array['Removes dead skin for a smoother, brighter glow', 'Sauna before and after opens and refreshes the skin', 'Helps even out dull, uneven skin tone', 'Leaves skin baby-soft and ready to absorb moisture', 'A deeply cleansing, restorative ritual'],
   90, 6000000, '/assets/images/moroccan-body-scrub.jpg', 5, true, false),
  ('facial-treatment', 'High Frequency Facial', 'Skincare',
   'A deep-cleansing facial finished with a high-frequency wand that gently energises the skin, helps calm breakouts and leaves the complexion clear and refreshed.',
   array['Deep-cleanses & unclogs congested pores', 'Helps calm breakouts and blemishes', 'Boosts circulation for a natural, healthy glow', 'Refines uneven skin texture', 'Leaves skin visibly smoother & refreshed'],
   60, 3000000, '/assets/images/facial-treatment.jpg', 6, true, false)
on conflict (slug) do update set
  name = excluded.name, category = excluded.category, description = excluded.description, benefits = excluded.benefits,
  duration_minutes = excluded.duration_minutes, price_minor = excluded.price_minor, compare_at_price_minor = null,
  image_url = excluded.image_url, sort_order = excluded.sort_order, is_active = true, is_package = false, is_demo = false;

update public.services set is_active = false
 where slug in ('nuru', 'thai-massage', 'pkg-essential', 'pkg-signature', 'pkg-ultimate');

-- Who offers the two new treatments: every active therapist, as for the others
-- until the owner sets it per therapist (staff app > Services & therapists).
insert into public.therapist_services (therapist_id, service_id)
select t.id, s.id
  from public.therapists t
  join public.services s on s.slug in ('aromatherapy', 'moroccan-scrub')
 where t.is_active
on conflict do nothing;

commit;
