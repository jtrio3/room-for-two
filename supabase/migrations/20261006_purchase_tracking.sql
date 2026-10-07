-- Room for Two v1.2: purchase tracking upgrade for an existing v1.1 project.
-- Run after 20261005_groups_expected_price.sql if upgrading from v1.0.
-- Additive and safe to rerun: no items, groups, backups, amounts, list positions,
-- plan links, or budget settings are replaced. Existing items start unpurchased.
-- Budgeted / worst-case labels retain sale / regular storage for compatibility.

begin;

-- A null purchase price means not purchased; zero is a valid completed purchase.
-- Dedicated mutations own this field so legacy item/backup edits cannot erase it.
alter table public.items add column if not exists purchase_price integer
  constraint items_purchase_price_valid check (purchase_price between 0 and 100000000);

create or replace function public.planner_read(p_key_hash text)
returns jsonb
language sql stable security invoker set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', p.id, 'revision', p.revision, 'personal', p.personal, 'gift', p.gift,
    'moveMonth', p.move_month, 'updatedAt', p.updated_at,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'notes', g.notes)
        order by g.created_at, g.id)
      from public.item_groups g where g.plan_id = p.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name, 'room', i.room, 'need', i.need,
        'priority', i.priority, 'groupId', i.group_id, 'url', i.url, 'image', i.image,
        'regular', i.regular, 'sale', i.sale, 'purchasePrice', i.purchase_price, 'notes', i.notes,
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

-- All edits lock one plan, compare its revision, and commit one complete change.
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
  v_group jsonb;
  v_id uuid;
  v_group_id uuid;
  v_order uuid[];
  v_ids uuid[];
  v_rank integer;
  v_position integer;
  v_new_group boolean := false;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$'
    or p_revision is null or p_revision < 0
    or jsonb_typeof(p_action) is distinct from 'object'
    or jsonb_typeof(p_action -> 'action') is distinct from 'string' then
    return jsonb_build_object('status', 400, 'error', 'Invalid request.');
  end if;
  v_action := p_action ->> 'action';
  if v_action not in ('save', 'delete', 'reorder', 'settings', 'saveGroup', 'removeGroup', 'purchase') then
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
      return jsonb_build_object('status', 400, 'error', 'Invalid list position or too many backup options.');
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

    -- Old clients omit groupId. Preserve membership; explicit null means unlink.
    select group_id into v_group_id from public.items where plan_id = v_plan.id and id = v_id;
    if v_item ? 'groupId' then
      if v_item -> 'groupId' = 'null'::jsonb then
        v_group_id := null;
      elsif jsonb_typeof(v_item -> 'groupId') = 'string'
        and (v_item ->> 'groupId') ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
        v_group_id := (v_item ->> 'groupId')::uuid;
      else
        return jsonb_build_object('status', 400, 'error', 'Invalid linked group.');
      end if;
    end if;
    if p_action ? 'newGroup' then
      v_group := p_action -> 'newGroup';
      if not public.planner_valid_group(v_group) then
        return jsonb_build_object('status', 400, 'error', 'Give the new group a name of up to 60 characters and a note of up to 1,000 characters.');
      end if;
      if not (v_item ? 'groupId') or v_group_id is distinct from (v_group ->> 'id')::uuid then
        return jsonb_build_object('status', 400, 'error', 'The new item group does not match.');
      end if;
      if exists (select 1 from public.item_groups where plan_id = v_plan.id and id = v_group_id) then
        return jsonb_build_object('status', 400, 'error', 'This group already exists. Choose the saved group instead.');
      end if;
      if exists (select 1 from public.item_groups where plan_id = v_plan.id
        and lower(btrim(name)) = lower(btrim(v_group ->> 'name'))) then
        return jsonb_build_object('status', 400, 'error', 'A group with this name already exists. Choose it or use another name.');
      end if;
      if (select count(*) from public.item_groups where plan_id = v_plan.id) >= 100 then
        return jsonb_build_object('status', 400, 'error', 'This plan supports up to 100 groups.');
      end if;
      v_new_group := true;
    elsif v_group_id is not null and not exists (
      select 1 from public.item_groups where plan_id = v_plan.id and id = v_group_id
    ) then
      return jsonb_build_object('status', 400, 'error', 'This group is no longer available. Choose another group or save without a group.');
    end if;

    -- Only reorder changes list order. New purchases always join the end.
    v_rank := array_position(v_order, v_id);
    if v_rank is null then
      v_order := v_order || array[v_id];
      v_rank := cardinality(v_order);
    end if;
    if v_new_group then
      insert into public.item_groups (plan_id, id, name, notes)
      values (v_plan.id, v_group_id, btrim(v_group ->> 'name'), v_group ->> 'notes');
    end if;
    insert into public.items (plan_id, id, name, room, need, priority, group_id, url, image, regular, sale, notes)
    values (v_plan.id, v_id, btrim(v_item ->> 'name'), v_item ->> 'room', v_item ->> 'need',
      v_rank, v_group_id, btrim(v_item ->> 'url'), btrim(v_item ->> 'image'),
      (v_item ->> 'regular')::numeric::integer, (v_item ->> 'sale')::numeric::integer, v_item ->> 'notes')
    on conflict (plan_id, id) do update set
      name = excluded.name, room = excluded.room, need = excluded.need,
      group_id = excluded.group_id, url = excluded.url, image = excluded.image,
      regular = excluded.regular, sale = excluded.sale, notes = excluded.notes;
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

  elsif v_action = 'saveGroup' then
    v_group := p_action -> 'group';
    if not public.planner_valid_group(v_group) then
      return jsonb_build_object('status', 400, 'error', 'Give the group a name of up to 60 characters and a note of up to 1,000 characters.');
    end if;
    if jsonb_typeof(p_action -> 'itemIds') is distinct from 'array' then
      return jsonb_build_object('status', 400, 'error', 'Invalid group membership.');
    end if;
    if jsonb_array_length(p_action -> 'itemIds') > 300 then
      return jsonb_build_object('status', 400, 'error', 'Invalid group membership.');
    end if;
    if exists (select 1 from jsonb_array_elements(p_action -> 'itemIds') e(value)
      where jsonb_typeof(value) is distinct from 'string'
        or (value #>> '{}') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') then
      return jsonb_build_object('status', 400, 'error', 'Invalid group membership.');
    end if;
    select coalesce(array_agg((value #>> '{}')::uuid), '{}'::uuid[])
      into v_ids from jsonb_array_elements(p_action -> 'itemIds') e(value);
    if (select count(distinct id) from unnest(v_ids) e(id)) <> cardinality(v_ids)
      or not (v_order @> v_ids) then
      return jsonb_build_object('status', 400, 'error', 'Some selected items are no longer available. Review the group members.');
    end if;
    v_group_id := (v_group ->> 'id')::uuid;
    if exists (select 1 from public.item_groups where plan_id = v_plan.id and id <> v_group_id
      and lower(btrim(name)) = lower(btrim(v_group ->> 'name'))) then
      return jsonb_build_object('status', 400, 'error', 'A group with this name already exists. Choose it or use another name.');
    end if;
    if not exists (select 1 from public.item_groups where plan_id = v_plan.id and id = v_group_id)
      and (select count(*) from public.item_groups where plan_id = v_plan.id) >= 100 then
      return jsonb_build_object('status', 400, 'error', 'This plan supports up to 100 groups.');
    end if;
    insert into public.item_groups (plan_id, id, name, notes)
    values (v_plan.id, v_group_id, btrim(v_group ->> 'name'), v_group ->> 'notes')
    on conflict (plan_id, id) do update set name = excluded.name, notes = excluded.notes;
    -- Full membership replacement alters no prices, descriptions, backups, or order.
    update public.items set group_id = null
      where plan_id = v_plan.id and group_id = v_group_id and not (id = any(v_ids));
    update public.items set group_id = v_group_id where plan_id = v_plan.id and id = any(v_ids);

  elsif v_action = 'removeGroup' then
    if jsonb_typeof(p_action -> 'id') is distinct from 'string'
      or (p_action ->> 'id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
      return jsonb_build_object('status', 400, 'error', 'Invalid group ID.');
    end if;
    v_group_id := (p_action ->> 'id')::uuid;
    if not exists (select 1 from public.item_groups where plan_id = v_plan.id and id = v_group_id) then
      return jsonb_build_object('status', 404, 'error', 'This group has already been removed.');
    end if;
    update public.items set group_id = null where plan_id = v_plan.id and group_id = v_group_id;
    delete from public.item_groups where plan_id = v_plan.id and id = v_group_id;

  elsif v_action = 'purchase' then
    if jsonb_typeof(p_action -> 'id') is distinct from 'string'
      or (p_action ->> 'id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
      return jsonb_build_object('status', 400, 'error', 'Invalid item ID.');
    end if;
    if not public.planner_valid_cents(p_action -> 'price', true) then
      return jsonb_build_object('status', 400, 'error', 'Enter a valid purchase amount, or clear the purchase.');
    end if;
    v_id := (p_action ->> 'id')::uuid;
    if not (v_id = any(v_order)) then
      return jsonb_build_object('status', 404, 'error', 'This item has already been removed.');
    end if;
    -- Scope to the locked plan even when another plan reuses an item UUID.
    update public.items set purchase_price = (p_action ->> 'price')::numeric::integer
      where plan_id = v_plan.id and id = v_id;

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

  if v_action in ('save', 'delete', 'reorder') then
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

-- Keep both replaced functions callable only by the trusted server role.
revoke all on function public.planner_read(text) from public, anon, authenticated;
revoke all on function public.planner_mutate(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.planner_read(text) to service_role;
grant execute on function public.planner_mutate(text, integer, jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
