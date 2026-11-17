-- DEMO SEED DATA - local development only.
--
-- Loaded by `supabase db reset` and by the automated tests. Never run against production.
-- Every row that could be mistaken for real client information is flagged
-- is_demo = true, and invented people are named "[DEMO] ...".
-- Catalogue rows mirror the current static site (src/data.ts) and stay flagged
-- as demo until the client verifies names, prices and durations.
-- To remove it all, see supabase/snippets/purge_demo_data.sql.

-- Online payment is on, with simulated (demo) payments allowed: development only.
-- Production must have allow_demo_payments = false (the default).
insert into public.business_settings (business_name, timezone, currency, online_payment_enabled, allow_demo_payments, payment_mode, deposit_percent,
                                     transfer_enabled, bank_name, bank_account_number, bank_account_name)
values ('SMM (Sweet Mobile Massage and Spa)', 'Africa/Lagos', 'NGN', true, true, 'full', 50,
        -- Direct bank transfer: the account shown on the previous version of the site (not yet confirmed by the client).
        true, 'Standard Chartered Bank', '0013819712', 'Sweet Mobile Massage and Spa Limited');

-- Placeholder opening hours: 09:00-21:00 every day.
insert into public.business_hours (day_of_week, is_closed, opens_at, closes_at)
select d, false, time '09:00', time '21:00' from generate_series(0, 6) as d;

insert into public.dispatch_zones (key, name, fee_minor, sort_order, is_demo) values
  ('maryland', 'Maryland / Mende / Ikeja', 0, 1, true),
  ('mainland', 'Surulere / Yaba / Gbagada', 300000, 2, true),
  ('airport', 'Ajao Estate / Airport Road', 600000, 3, true),
  ('vi', 'Victoria Island', 800000, 4, true),
  ('lekki', 'Lekki Phase 1 / Ikoyi', 1000000, 5, true);

-- Services (prices in kobo).
insert into public.services (slug, name, category, description, benefits, duration_minutes, price_minor, image_url, sort_order, is_demo) values
  ('facial-treatment', 'Premium Facial Treatment', 'Skincare',
   'An advanced hydrating facial using precision skin-resurfacing technology to deep-cleanse pores, boost circulation, and reveal a smoother, more radiant complexion.',
   array['Deep-cleanses & unclogs congested pores', 'Boosts collagen production & skin elasticity', 'Improves circulation for a natural, healthy glow', 'Reduces fine lines & uneven skin texture', 'Leaves skin visibly smoother & more hydrated'],
   60, 4500000, '/assets/images/facial-treatment.jpg', 1, true),
  ('swedish', 'Swedish Massage', 'Relaxation',
   'A classic relaxation therapy utilizing long, gliding strokes and gentle kneading to melt away daily stress and tension.',
   array['Promotes deep body relaxation & stress relief', 'Improves blood circulation & lymph flow', 'Relieves light muscle tension & joint stiffness', 'Alleviates mild headaches & migraines', 'Boosts overall well-being & enhances deep sleep'],
   60, 4000000, '/assets/images/swedish_massage_1783346044608.jpg', 2, true),
  ('deep-tissue', 'Deep Tissue Massage', 'Therapeutic',
   'Designed to target deep layers of muscle and connective tissue. Highly beneficial for chronic muscle tightness, soreness, and physical fatigue.',
   array['Alleviates chronic muscle pain & heavy tension', 'Improves posture, mobility, & overall range of motion', 'Breaks down painful scar tissue & knots', 'Accelerates muscle recovery & athletic repair', 'Provides profound somatic stress relief'],
   60, 4000000, '/assets/images/deep-tissue-massage.jpg', 3, true),
  ('hot-stone', 'Hot Stone Therapy', 'Sensory',
   'Combining smooth, heated basalt volcanic stones with traditional massage strokes to penetrate deep warmth into your muscles, encouraging deep sensory harmony.',
   array['Relieves intense muscle tension & somatic discomfort', 'Soothing thermal action improves blood circulation', 'Assists in deep lymphatic drainage', 'Soothes symptoms of restlessness, anxiety, & mental fatigue', 'Unlocks energy flow and emotional peace'],
   60, 5000000, '/assets/images/hot_stone_massage_1783345970205.jpg', 4, true),
  ('nuru', 'Nuru Massage', 'Sensory & Ultimate Wellness',
   'A deeply sensual and nourishing therapy that utilizes seaweed-based lubricants for a uniquely fluid, body-to-body touch technique that unlocks ultimate relaxation.',
   array['Provides an unmatched full-body sensory experience', 'Extremely skin-hydrating seaweed formulation', 'Deeply calming for the nervous system', 'Dissolves absolute muscular and psychological fatigue', 'Customized and catered with highest professional standards'],
   60, 8000000, '/assets/images/nuru-massage.jpg', 5, true),
  ('thai-massage', 'Thai Massage', 'Therapeutic',
   'A traditional therapy combining assisted stretching and rhythmic compression along the body''s energy lines to relieve tension, stress, and stiffness.',
   array['Relieves tension & stress throughout the body', 'Improves flexibility & joint range of motion', 'Stimulates circulation & energy flow', 'Eases stiffness in the back, hips, & shoulders', 'Leaves the mind and body feeling restored'],
   60, 4500000, '/assets/images/thai-massage.jpg', 6, true);

-- Packages.
insert into public.services (slug, name, category, description, benefits, duration_minutes, price_minor, compare_at_price_minor, is_package, is_popular, image_url, sort_order, is_demo) values
  ('pkg-essential', 'Essential Escape', 'Package',
   'A calming two-treatment introduction pairing our signature Swedish massage with warming Hot Stone therapy.',
   array['Swedish Massage (60 mins)', 'Hot Stone Therapy (60 mins)', 'Save ₦10,000 versus booking separately'],
   120, 8000000, 9000000, true, false, '/assets/images/spa_wellness_corner_1783345984514.jpg', 101, true),
  ('pkg-signature', 'Signature Retreat', 'Package',
   'Our most-booked combination — full-body relaxation, therapeutic muscle work, and soothing warmth in one extended sanctuary visit.',
   array['Swedish Massage (60 mins)', 'Deep Tissue Massage (60 mins)', 'Hot Stone Therapy (60 mins)', 'Save ₦20,000 versus booking separately'],
   180, 11000000, 13000000, true, true, '/assets/images/hot_stone_massage_1783345970205.jpg', 102, true),
  ('pkg-ultimate', 'Ultimate Indulgence', 'Package',
   'The complete SMM ritual — every signature therapy in a single unhurried, four-hour wellness journey.',
   array['Swedish Massage (60 mins)', 'Deep Tissue Massage (60 mins)', 'Hot Stone Therapy (60 mins)', 'Nuru Massage (60 mins)', 'Save ₦35,000 versus booking separately'],
   240, 17500000, 21000000, true, false, '/assets/images/spa_aromatherapy_1783346057871.jpg', 103, true);

insert into public.service_package_items (package_id, service_id, sort_order)
select p.id, s.id, i.sort_order
from (values
  ('pkg-essential', 'swedish', 1), ('pkg-essential', 'hot-stone', 2),
  ('pkg-signature', 'swedish', 1), ('pkg-signature', 'deep-tissue', 2), ('pkg-signature', 'hot-stone', 3),
  ('pkg-ultimate', 'swedish', 1), ('pkg-ultimate', 'deep-tissue', 2), ('pkg-ultimate', 'hot-stone', 3), ('pkg-ultimate', 'nuru', 4)
) as i (package_slug, service_slug, sort_order)
join public.services p on p.slug = i.package_slug
join public.services s on s.slug = i.service_slug;

-- Therapists: role-title placeholders, not real people.
insert into public.therapists (display_name, title, specialty, bio, photo_url, sort_order, is_demo) values
  ('Senior Massage Therapist', 'Swedish & Relaxation Massage', 'Swedish & Aromatherapy',
   'Brings a calm, intuitive touch to every session, easing tension through slow, rhythmic Swedish strokes and aromatic oils.',
   '/assets/images/team/therapist-1.jpg', 1, true),
  ('Lead Spa Therapist', 'Hot Stone & Aromatherapy', 'Hot Stone & Luxury Wellness',
   'Combines heated stones and warm aromatic oils to melt away deep-seated tension and restore a sense of balance.',
   '/assets/images/team/therapist-2.jpg', 2, true),
  ('Skincare & Facial Specialist', 'Facials & Skin Treatments', 'Facials & Waxing',
   'Delivers premium facials, waxing, and skin-glow treatments tailored to leave clients refreshed and radiant.',
   '/assets/images/team/therapist-3.jpg', 3, true),
  ('Wellness Therapist', 'Full Body Detox & Reflexology', 'Detox & Reflexology',
   'Specializes in full body detox and reflexology, helping clients release toxins and restore natural energy flow.',
   '/assets/images/team/therapist-4.jpg', 4, true);

-- Placeholder: every therapist offers every service.
insert into public.therapist_services (therapist_id, service_id)
select t.id, s.id from public.therapists t cross join public.services s;

-- Placeholder shifts: Monday-Saturday 09:00-20:00 with a 13:00-14:00 break.
insert into public.therapist_schedules (therapist_id, day_of_week, start_time, end_time)
select t.id, d, time '09:00', time '20:00' from public.therapists t cross join generate_series(1, 6) as d;

insert into public.therapist_breaks (therapist_id, day_of_week, start_time, end_time)
select t.id, d, time '13:00', time '14:00' from public.therapists t cross join generate_series(1, 6) as d;

-- Optional intake questions. All disabled until the owner switches them on.
insert into public.intake_questions (key, label, input_type, options, sort_order) values
  ('pressure', 'Preferred pressure', 'single_choice', '["Light", "Medium", "Firm"]', 1),
  ('focus_areas', 'Areas to focus on', 'text', '[]', 2),
  ('avoid_areas', 'Areas to avoid', 'text', '[]', 3),
  ('allergies', 'Relevant allergies or sensitivities', 'text', '[]', 4),
  ('other', 'Anything else your therapist should know before the session', 'textarea', '[]', 5);

-- Website content.
insert into public.site_content (key, value, description, is_demo) values
  ('contact', '{"address": "[DEMO] Address pending client confirmation", "phone": "[DEMO] Phone pending", "email": "demo@example.com", "whatsapp": null}',
   'Contact details shown in the footer and contact section', true),
  ('homepage.hero', '{"heading": "[DEMO] Hero heading", "subheading": "[DEMO] Hero subheading"}',
   'Homepage hero copy', true);

insert into public.faqs (question, answer, sort_order, is_demo) values
  ('How long is a typical massage session?',
   array['Our standard curated massage sessions are 60 minutes of hands-on treatment. Extended sessions can be arranged upon custom request.'], 1, true),
  ('What should I wear during a massage?',
   array['Wear loose, comfortable clothing that you can easily transition out of. During the massage, you will be professionally draped with white luxury linens at all times, exposing only the specific area being treated.'], 2, true),
  ('Do I need a prior appointment?',
   array['Yes, we operate strictly by appointment to guarantee a serene, uncrowded space for every guest.'], 3, true);

insert into public.testimonials (author_name, author_location, body, rating, is_published, is_demo) values
  ('[DEMO] Guest A', '[DEMO] Location', '[DEMO] Placeholder review. Replace with a verified client review before launch.', 5, true, true),
  ('[DEMO] Guest B', '[DEMO] Location', '[DEMO] Placeholder review. Replace with a verified client review before launch.', 5, true, true);

insert into public.gallery_items (title, category, image_url, sort_order, is_demo) values
  ('Serene Sanctuary Room', 'sanctuary', '/assets/images/spa_hero_banner_1783345955168.jpg', 1, true),
  ('Heated Volcanic Basalt Stones', 'treatments', '/assets/images/hot_stone_massage_1783345970205.jpg', 2, true),
  ('Aromatherapy Oils & Rituals', 'therapy', '/assets/images/spa_aromatherapy_1783346057871.jpg', 3, true),
  ('Relaxation Lounge', 'sanctuary', '/assets/images/spa_wellness_corner_1783345984514.jpg', 4, true),
  ('Professional Swedish Treatment', 'treatments', '/assets/images/swedish_massage_1783346044608.jpg', 5, true);

-- Demo customers and one demo appointment, for dashboard development.
insert into public.customers (full_name, email, phone, is_demo) values
  ('[DEMO] Ada Example', 'demo.ada@example.com', '+2340000000001', true),
  ('[DEMO] Bola Example', 'demo.bola@example.com', '+2340000000002', true);

insert into public.appointments (customer_id, service_id, therapist_id, starts_at, ends_at, blocked_until, status, price_minor, is_demo)
select c.id, s.id, t.id, slot.starts_at,
       slot.starts_at + make_interval(mins => s.duration_minutes),
       slot.starts_at + make_interval(mins => s.duration_minutes + s.buffer_minutes),
       'confirmed', s.price_minor, true
from public.customers c,
     public.services s,
     public.therapists t,
     (select ((current_date + 7) + time '10:00') at time zone 'Africa/Lagos' as starts_at) as slot
where c.email = 'demo.ada@example.com' and s.slug = 'swedish' and t.sort_order = 1;
