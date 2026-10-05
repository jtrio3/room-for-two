-- Room for Two: run this complete file in the Supabase SQL Editor.
-- Fresh-project setup; safe to rerun with this same schema. Amounts are integer
-- cents. No browser role can access the tables or call the planner functions.
-- The Netlify server uses the secret/service-role key after checking the plan link.

begin;

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  revision integer not null default 0 check (revision >= 0),
  personal integer not null default 1000000 check (personal between 0 and 100000000),
  gift integer not null default 200000 check (gift between 0 and 100000000),
  move_month text not null default '2026-11' check (move_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  updated_at bigint not null default floor(extract(epoch from clock_timestamp()) * 1000)::bigint
);

create table if not exists public.items (
  plan_id uuid not null references public.plans(id) on delete cascade,
  id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  room text not null check (room in ('Living room', 'Bedroom', 'Kitchen & dining', 'Bathroom', 'Home office', 'Outdoors', 'Other')),
  need text not null check (need in ('now', 'later')),
  priority integer not null check (priority between 1 and 301),
  url text not null default '' check (char_length(url) <= 2048 and (url = '' or url ~* '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$')),
  image text not null default '' check (char_length(image) <= 2048 and (image = '' or image ~* '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$')),
  regular integer check (regular between 0 and 100000000),
  sale integer check (sale between 0 and 100000000),
  notes text not null default '' check (char_length(notes) <= 4000),
  primary key (plan_id, id),
  constraint items_sale_not_above_regular check (sale is null or regular is null or sale <= regular),
  -- Deferred uniqueness permits atomic changes to all positions in one transaction.
  constraint items_plan_priority_unique unique (plan_id, priority) deferrable initially deferred
);

create table if not exists public.backups (
  plan_id uuid not null,
  item_id uuid not null,
  id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  url text not null default '' check (char_length(url) <= 2048 and (url = '' or url ~* '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$')),
  image text not null default '' check (char_length(image) <= 2048 and (image = '' or image ~* '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$')),
  regular integer check (regular between 0 and 100000000),
  sale integer check (sale between 0 and 100000000),
  notes text not null default '' check (char_length(notes) <= 4000),
  position integer not null check (position between 0 and 19),
  primary key (plan_id, item_id, id),
  foreign key (plan_id, item_id) references public.items(plan_id, id) on delete cascade,
  constraint backups_sale_not_above_regular check (sale is null or regular is null or sale <= regular),
  constraint backups_item_position_unique unique (plan_id, item_id, position) deferrable initially deferred
);

alter table public.plans enable row level security;
alter table public.items enable row level security;
alter table public.backups enable row level security;

-- Intentionally no anonymous/authenticated policies: all access is server-side.
revoke all on table public.plans, public.items, public.backups from public, anon, authenticated;
grant select, insert, update, delete on table public.plans, public.items, public.backups to service_role;
grant usage on schema public to service_role;

create or replace function public.planner_valid_cents(p_value jsonb, p_nullable boolean default false)
returns boolean
language plpgsql immutable security invoker set search_path = pg_catalog, public
as $$
declare
  v_number numeric;
begin
  if p_value is null then return false; end if;
  if p_value = 'null'::jsonb then return p_nullable; end if;
  if jsonb_typeof(p_value) <> 'number' then return false; end if;
  v_number := p_value::text::numeric;
  return v_number between 0 and 100000000 and v_number = trunc(v_number);
end;
$$;

create or replace function public.planner_valid_option(p_option jsonb)
returns boolean
language plpgsql immutable security invoker set search_path = pg_catalog, public
as $$
declare
  v_field text;
  v_link text;
begin
  if jsonb_typeof(p_option) is distinct from 'object'
    or not (p_option ?& array['id', 'name', 'url', 'image', 'regular', 'sale', 'notes']) then
    return false;
  end if;
  foreach v_field in array array['id', 'name', 'url', 'image', 'notes'] loop
    if jsonb_typeof(p_option -> v_field) is distinct from 'string' then return false; end if;
  end loop;
  if (p_option ->> 'id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or char_length(btrim(p_option ->> 'name')) not between 1 and 160
    or char_length(p_option ->> 'notes') > 4000 then return false; end if;
  foreach v_field in array array['url', 'image'] loop
    v_link := btrim(p_option ->> v_field);
    if char_length(v_link) > 2048 or
      (v_link <> '' and v_link !~* '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$') then return false; end if;
  end loop;
  if not public.planner_valid_cents(p_option -> 'regular', true)
    or not public.planner_valid_cents(p_option -> 'sale', true) then return false; end if;
  if p_option -> 'regular' <> 'null'::jsonb and p_option -> 'sale' <> 'null'::jsonb
    and (p_option ->> 'sale')::numeric > (p_option ->> 'regular')::numeric then return false; end if;
  return true;
end;
$$;

-- Both RPCs return exactly the same camelCase Plan shape used by the interface.
create or replace function public.planner_read(p_key_hash text)
returns jsonb
language sql stable security invoker set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', p.id, 'revision', p.revision, 'personal', p.personal, 'gift', p.gift,
    'moveMonth', p.move_month, 'updatedAt', p.updated_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name, 'room', i.room, 'need', i.need,
        'priority', i.priority, 'url', i.url, 'image', i.image,
        'regular', i.regular, 'sale', i.sale, 'notes', i.notes,
        'backups', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', b.id, 'name', b.name, 'url', b.url, 'image', b.image,
            'regular', b.regular, 'sale', b.sale, 'notes', b.notes
          ) order by b.position, b.id)
          from public.backups b where b.plan_id = i.plan_id and b.item_id = i.id
        ), '[]'::jsonb)
      ) order by i.priority, i.id)
      from public.items i where i.plan_id = p.id
    ), '[]'::jsonb)
  ) from public.plans p where p.key_hash = p_key_hash;
$$;

create or replace function public.planner_create(p_key_hash text)
returns jsonb
language plpgsql volatile security invoker set search_path = pg_catalog, public
as $$
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid plan key hash.';
  end if;
  insert into public.plans (key_hash) values (p_key_hash)
  on conflict (key_hash) do nothing;
  return public.planner_read(p_key_hash);
end;
$$;

-- All edits lock one plan, compare its revision, and commit a complete change.
-- A stale revision returns the fresh plan; it never overwrites another edit.
create or replace function public.planner_mutate(p_key_hash text, p_revision integer, p_action jsonb)
returns jsonb
language plpgsql volatile security invoker set search_path = pg_catalog, public
as $$
declare
  v_plan public.plans%rowtype;
  v_action text;
  v_item jsonb;
  v_backup jsonb;
  v_settings jsonb;
  v_id uuid;
  v_order uuid[];
  v_ids uuid[];
  v_rank integer;
  v_position integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$'
    or p_revision is null or p_revision < 0
    or jsonb_typeof(p_action) is distinct from 'object'
    or jsonb_typeof(p_action -> 'action') is distinct from 'string' then
    return jsonb_build_object('status', 400, 'error', 'Invalid request.');
  end if;
  v_action := p_action ->> 'action';
  if v_action not in ('save', 'delete', 'reorder', 'settings') then
    return jsonb_build_object('status', 400, 'error', 'Unknown action.');
  end if;

  select * into v_plan from public.plans where key_hash = p_key_hash for update;
  if not found then
    return jsonb_build_object('status', 404, 'error', 'This plan link was not found.');
  end if;
  if v_plan.revision <> p_revision then
    return jsonb_build_object('status', 409,
      'error', 'Your partner updated the plan. Review the latest list and save again; your draft is still here.',
      'plan', public.planner_read(p_key_hash));
  end if;
  if v_plan.revision = 2147483647 then
    return jsonb_build_object('status', 400, 'error', 'This plan has reached its revision limit.');
  end if;
  select coalesce(array_agg(id order by priority, id), '{}'::uuid[])
    into v_order from public.items where plan_id = v_plan.id;

  if v_action = 'save' then
    v_item := p_action -> 'item';
    if not public.planner_valid_option(v_item)
      or not (v_item ?& array['room', 'need', 'priority', 'backups'])
      or jsonb_typeof(v_item -> 'room') is distinct from 'string'
      or (v_item ->> 'room') not in ('Living room', 'Bedroom', 'Kitchen & dining', 'Bathroom', 'Home office', 'Outdoors', 'Other')
      or jsonb_typeof(v_item -> 'need') is distinct from 'string'
      or (v_item ->> 'need') not in ('now', 'later')
      or not public.planner_valid_cents(v_item -> 'priority')
      or jsonb_typeof(v_item -> 'backups') is distinct from 'array' then
      return jsonb_build_object('status', 400, 'error', 'Invalid item.');
    end if;
    if (v_item ->> 'priority')::numeric not between 1 and 301
      or jsonb_array_length(v_item -> 'backups') > 20 then
      return jsonb_build_object('status', 400, 'error', 'Invalid priority or too many backup options.');
    end if;
    for v_backup in select value from jsonb_array_elements(v_item -> 'backups') loop
      if not public.planner_valid_option(v_backup) then
        return jsonb_build_object('status', 400, 'error', 'Invalid backup option.');
      end if;
    end loop;
    if (select count(distinct (value ->> 'id')::uuid) from jsonb_array_elements(v_item -> 'backups'))
      <> jsonb_array_length(v_item -> 'backups') then
      return jsonb_build_object('status', 400, 'error', 'Duplicate backup option.');
    end if;
    v_id := (v_item ->> 'id')::uuid;
    if not (v_id = any(v_order)) and cardinality(v_order) >= 300 then
      return jsonb_build_object('status', 400, 'error', 'This plan supports up to 300 items.');
    end if;
    v_order := array_remove(v_order, v_id);
    v_rank := least((v_item ->> 'priority')::numeric::integer, cardinality(v_order) + 1);
    v_order := coalesce(v_order[1:v_rank - 1], '{}'::uuid[]) || array[v_id]
      || coalesce(v_order[v_rank:cardinality(v_order)], '{}'::uuid[]);

    insert into public.items (plan_id, id, name, room, need, priority, url, image, regular, sale, notes)
    values (v_plan.id, v_id, btrim(v_item ->> 'name'), v_item ->> 'room', v_item ->> 'need',
      301, btrim(v_item ->> 'url'), btrim(v_item ->> 'image'),
      (v_item ->> 'regular')::numeric::integer, (v_item ->> 'sale')::numeric::integer, v_item ->> 'notes')
    on conflict (plan_id, id) do update set
      name = excluded.name, room = excluded.room, need = excluded.need, priority = excluded.priority,
      url = excluded.url, image = excluded.image, regular = excluded.regular,
      sale = excluded.sale, notes = excluded.notes;
    delete from public.backups where plan_id = v_plan.id and item_id = v_id;
    v_position := 0;
    for v_backup in select value from jsonb_array_elements(v_item -> 'backups') loop
      insert into public.backups (plan_id, item_id, id, name, url, image, regular, sale, notes, position)
      values (v_plan.id, v_id, (v_backup ->> 'id')::uuid, btrim(v_backup ->> 'name'),
        btrim(v_backup ->> 'url'), btrim(v_backup ->> 'image'),
        (v_backup ->> 'regular')::numeric::integer, (v_backup ->> 'sale')::numeric::integer,
        v_backup ->> 'notes', v_position);
      v_position := v_position + 1;
    end loop;

  elsif v_action = 'delete' then
    if jsonb_typeof(p_action -> 'id') is distinct from 'string'
      or (p_action ->> 'id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
      return jsonb_build_object('status', 400, 'error', 'Invalid item ID.');
    end if;
    v_id := (p_action ->> 'id')::uuid;
    if not (v_id = any(v_order)) then
      return jsonb_build_object('status', 404, 'error', 'This item has already been removed.');
    end if;
    delete from public.items where plan_id = v_plan.id and id = v_id;
    v_order := array_remove(v_order, v_id);

  elsif v_action = 'reorder' then
    if jsonb_typeof(p_action -> 'ids') is distinct from 'array' then
      return jsonb_build_object('status', 400, 'error', 'Invalid item order.');
    end if;
    if jsonb_array_length(p_action -> 'ids') > 300 then
      return jsonb_build_object('status', 400, 'error', 'Invalid item order.');
    end if;
    if exists (select 1 from jsonb_array_elements(p_action -> 'ids') e(value)
      where jsonb_typeof(value) is distinct from 'string'
        or (value #>> '{}') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') then
      return jsonb_build_object('status', 400, 'error', 'Invalid item order.');
    end if;
    select coalesce(array_agg((value #>> '{}')::uuid order by ord), '{}'::uuid[])
      into v_ids from jsonb_array_elements(p_action -> 'ids') with ordinality e(value, ord);
    if cardinality(v_ids) <> cardinality(v_order)
      or (select count(distinct id) from unnest(v_ids) e(id)) <> cardinality(v_ids)
      or not (v_ids @> v_order) then
      return jsonb_build_object('status', 400, 'error', 'The list changed. Refresh before reordering.');
    end if;
    v_order := v_ids;

  else
    v_settings := p_action -> 'settings';
    if jsonb_typeof(v_settings) is distinct from 'object'
      or not public.planner_valid_cents(v_settings -> 'personal')
      or not public.planner_valid_cents(v_settings -> 'gift')
      or jsonb_typeof(v_settings -> 'moveMonth') is distinct from 'string'
      or (v_settings ->> 'moveMonth') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
      return jsonb_build_object('status', 400, 'error', 'Invalid budget settings.');
    end if;
    update public.plans set personal = (v_settings ->> 'personal')::numeric::integer,
      gift = (v_settings ->> 'gift')::numeric::integer, move_month = v_settings ->> 'moveMonth'
      where id = v_plan.id;
  end if;

  if v_action <> 'settings' then
    update public.items i set priority = ordering.position::integer
    from unnest(v_order) with ordinality as ordering(id, position)
    where i.plan_id = v_plan.id and i.id = ordering.id;
  end if;
  update public.plans set revision = revision + 1,
    updated_at = floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    where id = v_plan.id;
  return jsonb_build_object('status', 200, 'plan', public.planner_read(p_key_hash));
exception
  -- An exception rolls back this function's changes before returning an error.
  when check_violation or unique_violation or not_null_violation or foreign_key_violation
    or invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('status', 400, 'error', 'Invalid plan data. No changes were saved.');
end;
$$;

-- Supabase functions are executable by PUBLIC unless explicitly revoked.
revoke all on function public.planner_valid_cents(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.planner_valid_option(jsonb) from public, anon, authenticated;
revoke all on function public.planner_read(text) from public, anon, authenticated;
revoke all on function public.planner_create(text) from public, anon, authenticated;
revoke all on function public.planner_mutate(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.planner_valid_cents(jsonb, boolean) to service_role;
grant execute on function public.planner_valid_option(jsonb) to service_role;
grant execute on function public.planner_read(text) to service_role;
grant execute on function public.planner_create(text) to service_role;
grant execute on function public.planner_mutate(text, integer, jsonb) to service_role;

commit;
