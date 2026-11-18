-- The contact block takes a third phone number (the spa lists three lines).
-- Only the list of allowed fields changes; every check stays as it was.

create or replace function private.valid_site_content(p_key text, p_value jsonb)
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
    v_allowed := array['address', 'phone', 'phone_secondary', 'phone_third', 'email', 'whatsapp'];
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
    if v_name in ('phone', 'phone_secondary', 'phone_third', 'whatsapp') and v_text !~ '^\+?[0-9][0-9 ()-]{6,19}$' then
      return false;
    end if;
    if v_name = 'email' and v_text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
