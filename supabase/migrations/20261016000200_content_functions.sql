-- Phase 6a: staff functions for website content.
--
-- Owner and admin manage FAQs, testimonials, gallery items, announcements,
-- the keyed site content blocks and the media library through these
-- functions only. Each one checks the caller's role first, refuses an edit
-- made from an out-of-date version, and labels its audit entries.
--
-- Rules that hold everywhere:
--   * New items start unpublished; publishing is its own audited action.
--   * A published item cannot be deleted: it is unpublished first. Deleting
--     needs a reason.
--   * A media file cannot be removed while anything refers to it.
--   * All text is stored and shown as plain text.

-- =========================================================================
-- 1. Helpers
-- =========================================================================

-- The table behind a content kind. Used to build statements below, so it
-- only ever returns one of these fixed names.
create function private.content_table(p_kind text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  return case p_kind
    when 'faq' then 'faqs'
    when 'testimonial' then 'testimonials'
    when 'gallery' then 'gallery_items'
    when 'announcement' then 'announcements'
    else null
  end;
end;
$$;

-- The site content blocks that exist, and what each may hold: text values
-- only, under known names.
create function private.valid_site_content(p_key text, p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_allowed text[];
  v_name text;
  v_item jsonb;
  v_text text;
begin
  if p_key = 'contact' then
    v_allowed := array['address', 'phone', 'phone_secondary', 'email', 'whatsapp'];
  elsif p_key = 'homepage.hero' then
    v_allowed := array['heading', 'subheading'];
  end if;
  if v_allowed is null or p_value is null or jsonb_typeof(p_value) <> 'object' then
    return false;
  end if;
  for v_name, v_item in select * from jsonb_each(p_value) loop
    if v_name <> all (v_allowed) then
      return false;
    end if;
    continue when jsonb_typeof(v_item) = 'null';
    if jsonb_typeof(v_item) <> 'string' then
      return false;
    end if;
    v_text := v_item #>> '{}';
    if (v_name in ('address', 'subheading') and length(v_text) > 300)
       or (v_name not in ('address', 'subheading') and length(v_text) > 120) then
      return false;
    end if;
    if v_name in ('phone', 'phone_secondary', 'whatsapp') and v_text !~ '^\+?[0-9][0-9 ()-]{6,19}$' then
      return false;
    end if;
    if v_name = 'email' and v_text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- =========================================================================
-- 2. Reading (owner/admin): everything, published or not
-- =========================================================================
create function public.staff_content()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  return jsonb_build_object(
    'faqs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'question', f.question, 'answer', to_jsonb(f.answer), 'sort_order', f.sort_order,
        'is_published', f.is_published, 'updated_at', f.updated_at
      ) order by f.sort_order, f.created_at)
      from public.faqs f
    ), '[]'::jsonb),
    'testimonials', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'author_name', t.author_name, 'author_location', t.author_location, 'body', t.body,
        'rating', t.rating, 'service_id', t.service_id, 'service_name', s.name, 'sort_order', t.sort_order,
        'is_published', t.is_published, 'updated_at', t.updated_at
      ) order by t.sort_order, t.created_at)
      from public.testimonials t left join public.services s on s.id = t.service_id
    ), '[]'::jsonb),
    'gallery', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'title', g.title, 'category', g.category, 'image_url', g.image_url,
        'image_media_id', g.image_media_id, 'media_path', m.path, 'media_bucket', m.bucket,
        'sort_order', g.sort_order, 'is_published', g.is_published, 'updated_at', g.updated_at
      ) order by g.sort_order, g.created_at)
      from public.gallery_items g left join public.media_assets m on m.id = g.image_media_id
    ), '[]'::jsonb),
    'announcements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'title', a.title, 'body', a.body, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
        'is_published', a.is_published, 'updated_at', a.updated_at
      ) order by a.created_at desc)
      from public.announcements a
    ), '[]'::jsonb),
    'site_content', (
      select jsonb_agg(jsonb_build_object(
        'key', k.key, 'value', c.value, 'is_published', coalesce(c.is_published, false), 'updated_at', c.updated_at
      ) order by k.key)
      from (values ('contact'), ('homepage.hero')) as k (key)
      left join public.site_content c on c.key = k.key
    ),
    'media', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'bucket', m.bucket, 'path', m.path, 'alt_text', m.alt_text, 'mime_type', m.mime_type,
        'size_bytes', m.size_bytes, 'width', m.width, 'height', m.height, 'created_at', m.created_at,
        'updated_at', m.updated_at,
        'uses', (select count(*) from public.gallery_items g where g.image_media_id = m.id)
              + (select count(*) from public.services s where s.image_media_id = m.id)
              + (select count(*) from public.therapists t where t.photo_media_id = m.id)
      ) order by m.created_at desc)
      from public.media_assets m
    ), '[]'::jsonb)
  );
end;
$$;

-- =========================================================================
-- 3. Saving (create with a null id, or edit)
-- =========================================================================

-- Fields: question, answer (array of paragraphs), sort_order (optional).
create function public.staff_save_faq(p_faq_id uuid, p_expected_updated_at timestamptz, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.faqs;
  v_question text;
  v_answer text[];
  v_sort integer;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'invalid_content' using errcode = 'P0001';
  end if;
  begin
    v_question := trim(coalesce(p_fields ->> 'question', ''));
    v_answer := array(
      select trim(a) from jsonb_array_elements_text(coalesce(p_fields -> 'answer', '[]'::jsonb)) a where trim(a) <> ''
    );
    v_sort := (p_fields ->> 'sort_order')::integer;
  exception
    when others then
      raise exception 'invalid_content' using errcode = 'P0001';
  end;
  if length(v_question) < 3 or length(v_question) > 300
     or cardinality(v_answer) < 1 or cardinality(v_answer) > 10
     or exists (select 1 from unnest(v_answer) a where length(a) > 2000)
     or (v_sort is not null and v_sort not between -100000 and 100000) then
    raise exception 'invalid_content' using errcode = 'P0001';
  end if;

  if p_faq_id is null then
    perform private.audit_label('content.faq_created');
    insert into public.faqs (question, answer, sort_order, is_published)
    values (v_question, v_answer, coalesce(v_sort, (select coalesce(max(f.sort_order), 0) + 1 from public.faqs f)), false)
    returning * into v_row;
  else
    select * into v_row from public.faqs f where f.id = p_faq_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    perform private.require_current(v_row.updated_at, p_expected_updated_at);
    perform private.audit_label('content.faq_updated');
    update public.faqs
       set question = v_question, answer = v_answer, sort_order = coalesce(v_sort, sort_order)
     where id = v_row.id
    returning * into v_row;
  end if;
  perform private.audit_clear();
  return jsonb_build_object('id', v_row.id, 'updated_at', v_row.updated_at, 'is_published', v_row.is_published);
end;
$$;

-- Fields: author_name, author_location, body, rating (1-5), service_id (optional), sort_order (optional).
create function public.staff_save_testimonial(p_testimonial_id uuid, p_expected_updated_at timestamptz, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.testimonials;
  v_name text;
  v_location text;
  v_body text;
  v_rating integer;
  v_service uuid;
  v_sort integer;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'invalid_content' using errcode = 'P0001';
  end if;
  begin
    v_name := trim(coalesce(p_fields ->> 'author_name', ''));
    v_location := nullif(trim(coalesce(p_fields ->> 'author_location', '')), '');
    v_body := trim(coalesce(p_fields ->> 'body', ''));
    v_rating := (p_fields ->> 'rating')::integer;
    v_service := nullif(p_fields ->> 'service_id', '')::uuid;
    v_sort := (p_fields ->> 'sort_order')::integer;
  exception
    when others then
      raise exception 'invalid_content' using errcode = 'P0001';
  end;
  if length(v_name) < 2 or length(v_name) > 80 or length(coalesce(v_location, '')) > 80
     or length(v_body) < 10 or length(v_body) > 1000
     or v_rating is null or v_rating not between 1 and 5
     or (v_sort is not null and v_sort not between -100000 and 100000)
     or (v_service is not null and not exists (select 1 from public.services s where s.id = v_service)) then
    raise exception 'invalid_content' using errcode = 'P0001';
  end if;

  if p_testimonial_id is null then
    perform private.audit_label('content.testimonial_created');
    insert into public.testimonials (author_name, author_location, body, rating, service_id, sort_order, is_published)
    values (v_name, v_location, v_body, v_rating, v_service,
            coalesce(v_sort, (select coalesce(max(t.sort_order), 0) + 1 from public.testimonials t)), false)
    returning * into v_row;
  else
    select * into v_row from public.testimonials t where t.id = p_testimonial_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    perform private.require_current(v_row.updated_at, p_expected_updated_at);
    perform private.audit_label('content.testimonial_updated');
    update public.testimonials
       set author_name = v_name, author_location = v_location, body = v_body, rating = v_rating,
           service_id = v_service, sort_order = coalesce(v_sort, sort_order)
     where id = v_row.id
    returning * into v_row;
  end if;
  perform private.audit_clear();
  return jsonb_build_object('id', v_row.id, 'updated_at', v_row.updated_at, 'is_published', v_row.is_published);
end;
$$;

-- Fields: title, category, and one image: image_media_id (an uploaded file)
-- or image_url (a file shipped with the site, under /assets/); sort_order (optional).
create function public.staff_save_gallery_item(p_item_id uuid, p_expected_updated_at timestamptz, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.gallery_items;
  v_title text;
  v_category text;
  v_url text;
  v_media uuid;
  v_sort integer;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'invalid_content' using errcode = 'P0001';
  end if;
  begin
    v_title := trim(coalesce(p_fields ->> 'title', ''));
    v_category := lower(trim(coalesce(p_fields ->> 'category', '')));
    v_url := nullif(trim(coalesce(p_fields ->> 'image_url', '')), '');
    v_media := nullif(p_fields ->> 'image_media_id', '')::uuid;
    v_sort := (p_fields ->> 'sort_order')::integer;
  exception
    when others then
      raise exception 'invalid_content' using errcode = 'P0001';
  end;
  if v_media is not null then
    v_url := null; -- the uploaded file wins
  end if;
  if length(v_title) < 2 or length(v_title) > 120 or v_category !~ '^[a-z0-9 -]{0,40}$'
     or (v_media is null and v_url is null)
     or (v_url is not null and (v_url !~ '^/assets/[A-Za-z0-9._/-]{1,200}$' or v_url like '%..%'))
     or (v_sort is not null and v_sort not between -100000 and 100000) then
    raise exception 'invalid_content' using errcode = 'P0001';
  end if;
  -- Holds the file in place until this change is committed, so it cannot be
  -- removed from the library at the same moment.
  if v_media is not null then
    perform 1 from public.media_assets m where m.id = v_media for share;
    if not found then
      raise exception 'media_not_found' using errcode = 'P0001';
    end if;
  end if;

  if p_item_id is null then
    perform private.audit_label('content.gallery_item_created');
    insert into public.gallery_items (title, category, image_url, image_media_id, sort_order, is_published)
    values (v_title, v_category, v_url, v_media,
            coalesce(v_sort, (select coalesce(max(g.sort_order), 0) + 1 from public.gallery_items g)), false)
    returning * into v_row;
  else
    select * into v_row from public.gallery_items g where g.id = p_item_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    perform private.require_current(v_row.updated_at, p_expected_updated_at);
    perform private.audit_label('content.gallery_item_updated');
    update public.gallery_items
       set title = v_title, category = v_category, image_url = v_url, image_media_id = v_media,
           sort_order = coalesce(v_sort, sort_order)
     where id = v_row.id
    returning * into v_row;
  end if;
  perform private.audit_clear();
  return jsonb_build_object('id', v_row.id, 'updated_at', v_row.updated_at, 'is_published', v_row.is_published);
end;
$$;

-- Fields: kind (announcement | promotion), title, body, starts_at, ends_at (both optional).
create function public.staff_save_announcement(p_announcement_id uuid, p_expected_updated_at timestamptz, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.announcements;
  v_kind text;
  v_title text;
  v_body text;
  v_starts timestamptz;
  v_ends timestamptz;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'invalid_content' using errcode = 'P0001';
  end if;
  begin
    v_kind := coalesce(nullif(trim(coalesce(p_fields ->> 'kind', '')), ''), 'announcement');
    v_title := trim(coalesce(p_fields ->> 'title', ''));
    v_body := trim(coalesce(p_fields ->> 'body', ''));
    v_starts := nullif(p_fields ->> 'starts_at', '')::timestamptz;
    v_ends := nullif(p_fields ->> 'ends_at', '')::timestamptz;
  exception
    when others then
      raise exception 'invalid_content' using errcode = 'P0001';
  end;
  if v_kind not in ('announcement', 'promotion') or length(v_title) < 2 or length(v_title) > 120
     or length(v_body) > 1000 or (v_starts is not null and v_ends is not null and v_starts >= v_ends) then
    raise exception 'invalid_content' using errcode = 'P0001';
  end if;

  if p_announcement_id is null then
    perform private.audit_label('content.announcement_created');
    insert into public.announcements (kind, title, body, starts_at, ends_at, is_published)
    values (v_kind, v_title, v_body, v_starts, v_ends, false)
    returning * into v_row;
  else
    select * into v_row from public.announcements a where a.id = p_announcement_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    perform private.require_current(v_row.updated_at, p_expected_updated_at);
    perform private.audit_label('content.announcement_updated');
    update public.announcements
       set kind = v_kind, title = v_title, body = v_body, starts_at = v_starts, ends_at = v_ends
     where id = v_row.id
    returning * into v_row;
  end if;
  perform private.audit_clear();
  return jsonb_build_object('id', v_row.id, 'updated_at', v_row.updated_at, 'is_published', v_row.is_published);
end;
$$;

-- A keyed block (contact details, homepage heading). Only the known keys
-- exist; a block that has never been saved is created with a null version.
create function public.staff_save_site_content(
  p_key text,
  p_expected_updated_at timestamptz,
  p_value jsonb,
  p_is_published boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.site_content;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  if p_is_published is null or not private.valid_site_content(p_key, p_value) then
    raise exception 'invalid_content' using errcode = 'P0001';
  end if;

  select * into v_row from public.site_content c where c.key = p_key for update;
  if found then
    perform private.require_current(v_row.updated_at, p_expected_updated_at);
    perform private.audit_label('content.site_content_updated');
    update public.site_content
       set value = p_value, is_published = p_is_published, is_demo = false, updated_by = (select auth.uid())
     where key = p_key
    returning * into v_row;
  else
    if p_expected_updated_at is not null then
      raise exception 'stale_record' using errcode = 'P0001';
    end if;
    perform private.audit_label('content.site_content_updated');
    begin
      insert into public.site_content (key, value, is_published, updated_by)
      values (p_key, p_value, p_is_published, (select auth.uid()))
      returning * into v_row;
    exception
      when unique_violation then -- someone else created it a moment ago
        raise exception 'stale_record' using errcode = 'P0001';
    end;
  end if;
  perform private.audit_clear();
  return jsonb_build_object('key', v_row.key, 'updated_at', v_row.updated_at, 'is_published', v_row.is_published);
end;
$$;

-- =========================================================================
-- 4. Publishing, ordering, deleting
-- =========================================================================

-- Show an item on the website, or take it off. p_kind: faq | testimonial | gallery | announcement.
create function public.staff_set_content_published(
  p_kind text,
  p_id uuid,
  p_published boolean,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_updated timestamptz;
  v_published boolean;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  v_table := private.content_table(p_kind);
  if v_table is null or p_published is null then
    raise exception 'invalid_content' using errcode = 'P0001';
  end if;
  execute format('select t.updated_at, t.is_published from public.%I t where t.id = $1 for update', v_table)
    into v_updated, v_published using p_id;
  if v_updated is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_current(v_updated, p_expected_updated_at);
  if v_published is distinct from p_published then
    perform private.audit_label(case when p_published then 'content.published' else 'content.unpublished' end);
    execute format('update public.%I set is_published = $2 where id = $1 returning updated_at', v_table)
      into v_updated using p_id, p_published;
    perform private.audit_clear();
  end if;
  return jsonb_build_object('id', p_id, 'updated_at', v_updated, 'is_published', p_published);
end;
$$;

-- Put a list in the given order. p_ids must be exactly the current items of
-- that kind (faq | testimonial | gallery); if one was added or removed in
-- the meantime the screen is out of date and the call is refused.
create function public.staff_reorder_content(p_kind text, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_current uuid[];
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  v_table := case when p_kind in ('faq', 'testimonial', 'gallery') then private.content_table(p_kind) end;
  if v_table is null or p_ids is null then
    raise exception 'invalid_content' using errcode = 'P0001';
  end if;
  execute format('select t.id from public.%I t order by t.id for update', v_table);
  execute format('select coalesce(array_agg(t.id order by t.id), ''{}'') from public.%I t', v_table) into v_current;
  if v_current is distinct from array(select distinct x from unnest(p_ids) x order by 1)
     or cardinality(p_ids) <> cardinality(v_current) then
    raise exception 'stale_record' using errcode = 'P0001';
  end if;
  perform private.audit_label('content.reordered');
  execute format(
    'update public.%I t set sort_order = x.ord
       from unnest($1) with ordinality as x (id, ord)
      where t.id = x.id and t.sort_order is distinct from x.ord', v_table)
    using p_ids;
  perform private.audit_clear();
end;
$$;

-- Delete an item for good. It must be off the website first, and a reason
-- is recorded. p_kind: faq | testimonial | gallery | announcement.
create function public.staff_delete_content(
  p_kind text,
  p_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_reason text;
  v_updated timestamptz;
  v_published boolean;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  v_reason := private.require_reason(p_reason);
  v_table := private.content_table(p_kind);
  if v_table is null then
    raise exception 'invalid_content' using errcode = 'P0001';
  end if;
  execute format('select t.updated_at, t.is_published from public.%I t where t.id = $1 for update', v_table)
    into v_updated, v_published using p_id;
  if v_updated is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_current(v_updated, p_expected_updated_at);
  if v_published then
    raise exception 'still_published' using errcode = 'P0001';
  end if;
  perform private.audit_label('content.' || p_kind || '_deleted', v_reason);
  execute format('delete from public.%I where id = $1', v_table) using p_id;
  perform private.audit_clear();
end;
$$;

-- =========================================================================
-- 5. Media library
-- =========================================================================

-- Adds an uploaded file to the library. The staff-media Edge Function calls
-- this, as the signed-in staff member, right after it has checked and stored
-- the file. Staff cannot write to Storage themselves, so a file existing at
-- one of these generated paths means the server put it there: nothing else
-- can be registered. The file type comes from the path the server chose.
create function public.staff_register_media(
  p_path text,
  p_size_bytes bigint,
  p_width integer default null,
  p_height integer default null,
  p_alt_text text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.media_assets;
  v_alt text := trim(coalesce(p_alt_text, ''));
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  if p_path is null
     or p_path !~ '^(gallery|services|therapists|site)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|avif)$'
     or p_size_bytes is null or p_size_bytes not between 1 and 5242880
     or (p_width is not null and p_width not between 1 and 20000)
     or (p_height is not null and p_height not between 1 and 20000)
     or length(v_alt) > 300 then
    raise exception 'invalid_media' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'site-media' and o.name = p_path) then
    raise exception 'media_not_uploaded' using errcode = 'P0001';
  end if;

  perform private.audit_label('content.media_added');
  begin
    insert into public.media_assets (bucket, path, alt_text, mime_type, size_bytes, width, height, created_by)
    values ('site-media', p_path, v_alt,
            case substring(p_path from '\.([a-z]+)$')
              when 'jpg' then 'image/jpeg' when 'png' then 'image/png' when 'webp' then 'image/webp' else 'image/avif' end,
            p_size_bytes, p_width, p_height, (select auth.uid()))
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'media_exists' using errcode = 'P0001';
  end;
  perform private.audit_clear();
  return jsonb_build_object('id', v_row.id, 'bucket', v_row.bucket, 'path', v_row.path, 'mime_type', v_row.mime_type,
                            'alt_text', v_row.alt_text, 'updated_at', v_row.updated_at);
end;
$$;

-- The description read out by screen readers.
create function public.staff_update_media(p_media_id uuid, p_expected_updated_at timestamptz, p_alt_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.media_assets;
  v_alt text := trim(coalesce(p_alt_text, ''));
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  if length(v_alt) > 300 then
    raise exception 'invalid_media' using errcode = 'P0001';
  end if;
  select * into v_row from public.media_assets m where m.id = p_media_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_current(v_row.updated_at, p_expected_updated_at);
  perform private.audit_label('content.media_updated');
  update public.media_assets set alt_text = v_alt where id = v_row.id returning * into v_row;
  perform private.audit_clear();
  return jsonb_build_object('id', v_row.id, 'alt_text', v_row.alt_text, 'updated_at', v_row.updated_at);
end;
$$;

-- Takes a file out of the library. Refused while a gallery item, service or
-- therapist refers to it (published or not). Returns where the file is, so
-- the staff-media function can delete it from Storage.
create function public.staff_remove_media(p_media_id uuid, p_reason text, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.media_assets;
  v_reason text;
begin
  perform private.require_staff(array['owner', 'admin']::public.staff_role[]);
  v_reason := private.require_reason(p_reason);
  select * into v_row from public.media_assets m where m.id = p_media_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.require_current(v_row.updated_at, p_expected_updated_at);
  if exists (select 1 from public.gallery_items g where g.image_media_id = v_row.id)
     or exists (select 1 from public.services s where s.image_media_id = v_row.id)
     or exists (select 1 from public.therapists t where t.photo_media_id = v_row.id) then
    raise exception 'media_in_use' using errcode = 'P0001';
  end if;
  perform private.audit_label('content.media_removed', v_reason);
  delete from public.media_assets where id = v_row.id;
  perform private.audit_clear();
  return jsonb_build_object('id', v_row.id, 'bucket', v_row.bucket, 'path', v_row.path);
end;
$$;

-- =========================================================================
-- Privileges
-- =========================================================================
revoke execute on function private.content_table(text), private.valid_site_content(text, jsonb) from public;

revoke execute on function
  public.staff_content(),
  public.staff_save_faq(uuid, timestamptz, jsonb),
  public.staff_save_testimonial(uuid, timestamptz, jsonb),
  public.staff_save_gallery_item(uuid, timestamptz, jsonb),
  public.staff_save_announcement(uuid, timestamptz, jsonb),
  public.staff_save_site_content(text, timestamptz, jsonb, boolean),
  public.staff_set_content_published(text, uuid, boolean, timestamptz),
  public.staff_reorder_content(text, uuid[]),
  public.staff_delete_content(text, uuid, text, timestamptz),
  public.staff_register_media(text, bigint, integer, integer, text),
  public.staff_update_media(uuid, timestamptz, text),
  public.staff_remove_media(uuid, text, timestamptz)
from public, anon;

grant execute on function
  public.staff_content(),
  public.staff_save_faq(uuid, timestamptz, jsonb),
  public.staff_save_testimonial(uuid, timestamptz, jsonb),
  public.staff_save_gallery_item(uuid, timestamptz, jsonb),
  public.staff_save_announcement(uuid, timestamptz, jsonb),
  public.staff_save_site_content(text, timestamptz, jsonb, boolean),
  public.staff_set_content_published(text, uuid, boolean, timestamptz),
  public.staff_reorder_content(text, uuid[]),
  public.staff_delete_content(text, uuid, text, timestamptz),
  public.staff_register_media(text, bigint, integer, integer, text),
  public.staff_update_media(uuid, timestamptz, text),
  public.staff_remove_media(uuid, text, timestamptz)
to authenticated;
