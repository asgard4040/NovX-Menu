begin;

alter table public.staff drop constraint staff_role_check;
alter table public.staff add constraint staff_role_check check (role in ('waiter','kitchen','cashier'));
alter table public.staff_passcodes drop constraint staff_passcodes_role_check;
alter table public.staff_passcodes add constraint staff_passcodes_role_check
  check (role in ('owner','manager','waiter','kitchen','cashier'));

-- Optional placements override the default grid generated from the QR table count.
create table public.restaurant_table_layouts (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  placements jsonb not null default '[]'::jsonb
);
alter table public.restaurant_table_layouts enable row level security;
revoke all on public.restaurant_table_layouts from public, anon, authenticated;
grant select, insert, update on public.restaurant_table_layouts to authenticated;
create policy table_layout_read on public.restaurant_table_layouts for select to authenticated
using (public.restaurant_subscription_active(restaurant_id)
  and public.has_restaurant_role(restaurant_id, array['owner','manager','cashier']::public.member_role[]));
create policy table_layout_insert on public.restaurant_table_layouts for insert to authenticated
with check (public.restaurant_subscription_active(restaurant_id)
  and public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[]));
create policy table_layout_update on public.restaurant_table_layouts for update to authenticated
using (public.restaurant_subscription_active(restaurant_id)
  and public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[]))
with check (public.restaurant_subscription_active(restaurant_id)
  and public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[]));

create function ordova_private.validate_table_layout()
returns trigger language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(new.placements) <> 'array' then raise exception 'invalid_table_layout'; end if;
  if jsonb_array_length(new.placements) > 500 or exists (
    select 1 from jsonb_array_elements(new.placements) p
    where jsonb_typeof(p) <> 'object'
      or jsonb_typeof(p->'table') is distinct from 'number'
      or coalesce(p->>'table','') !~ '^[1-9][0-9]{0,2}$'
      or (p->>'table')::numeric > 500
      or jsonb_typeof(p->'slot') is distinct from 'number'
      or coalesce(p->>'slot','') !~ '^(0|[1-9][0-9]{0,2})$'
      or (p->>'slot')::numeric >= 528
      or coalesce(p->>'shape','') not in ('round','square','rect')
  ) or exists (
    select 1 from jsonb_array_elements(new.placements) p
    group by p->>'slot' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(new.placements) p
    group by p->>'table' having count(*) > 1
  ) then raise exception 'invalid_table_layout'; end if;
  return new;
end;
$$;
revoke execute on function ordova_private.validate_table_layout() from public, anon, authenticated;
create trigger validate_table_layout before insert or update on public.restaurant_table_layouts
for each row execute function ordova_private.validate_table_layout();

create function ordova_private.guard_cashier_order_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_system_admin() or not public.has_restaurant_role(old.restaurant_id, array['cashier']::public.member_role[]) then
    return new;
  end if;
  if old.cleared_for_staff
    or not ((old.status = 'pending' and new.status = 'preparing') or (old.status = 'ready' and new.status = 'served'))
    or (to_jsonb(new) - array['status','approved_at','updated_at'])
       is distinct from (to_jsonb(old) - array['status','approved_at','updated_at']) then
    raise exception 'invalid_cashier_transition' using errcode = '42501';
  end if;
  new.approved_at := case when new.status = 'preparing' then now() else old.approved_at end;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function ordova_private.guard_cashier_order_update() from public, anon, authenticated;
create trigger guard_cashier_order_update before update on public.orders
for each row execute function ordova_private.guard_cashier_order_update();

create function public.create_cashier_order(
  p_restaurant uuid, p_table text, p_name text, p_notes text, p_items jsonb, p_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare venue public.restaurants; existing uuid; priced jsonb; created public.orders;
begin
  if not public.has_restaurant_role(p_restaurant, array['cashier']::public.member_role[]) then
    raise exception 'cashier_required' using errcode = '42501';
  end if;
  select * into venue from public.restaurants where id = p_restaurant for update;
  if not coalesce(public.subscription_active(venue), false) then raise exception 'subscription_inactive'; end if;
  if p_key is null then raise exception 'invalid_idempotency_key'; end if;
  select resource_id into existing from public.idempotency_keys
    where scope = 'cashier_order' and restaurant_id = p_restaurant and key = p_key::text;
  if existing is not null then
    return (select jsonb_build_object('id',id,'orderNumber',order_number) from public.orders where id = existing);
  end if;

  if p_table is distinct from 'counter' then
    if coalesce(p_table,'') !~ '^[1-9][0-9]{0,2}$' or p_table::numeric > venue.table_count then
      raise exception 'invalid_table';
    end if;
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid_order'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 or exists (
    select 1 from jsonb_array_elements(p_items) p
    where jsonb_typeof(p) <> 'object' or coalesce(p->>'quantity','') !~ '^[1-9][0-9]?$'
  ) then raise exception 'invalid_order'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) p
    join public.menu_items m on m.id = (p->>'id')::uuid and m.restaurant_id = p_restaurant
    where (coalesce((p->>'cheeseSelected')::boolean,false) and not m.has_cheese)
      or (coalesce((p->>'spicySelected')::boolean,false) and not m.is_spicy)
  ) then raise exception 'invalid_menu_item'; end if;
  priced := ordova_private.price_customer_order(p_restaurant, p_items);
  if priced is null then raise exception 'invalid_menu_item'; end if;
  select * into created from ordova_private.insert_pending_order(
    p_restaurant, coalesce(nullif(btrim(p_name),''),'Guest'), p_table, coalesce(p_notes,''),
    priced, jsonb_build_object('source','cashier'), gen_random_uuid()::text);
  update public.orders set status = 'preparing' where id = created.id;
  insert into public.idempotency_keys values ('cashier_order',p_restaurant,p_key::text,created.id,now());
  return jsonb_build_object('id',created.id,'orderNumber',created.order_number);
end;
$$;
revoke execute on function public.create_cashier_order(uuid,text,text,text,jsonb,uuid) from public, anon;
grant execute on function public.create_cashier_order(uuid,text,text,text,jsonb,uuid) to authenticated;

create or replace function public.queue_order_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare event_name text;
begin
  if tg_op = 'INSERT' then
    event_name := case
      when new.status = 'pending' and new.device_metadata->>'source' is distinct from 'cashier' then 'customer_order'
      when new.status = 'preparing' then 'kitchen_order'
    end;
  elsif old.status is distinct from new.status then
    event_name := case when new.status = 'preparing' then 'kitchen_order' when new.status = 'ready' then 'order_ready' end;
  end if;
  if event_name is not null then
    insert into public.notification_outbox(restaurant_id,event_type,payload)
    values (new.restaurant_id,event_name,jsonb_build_object(
      'order_id',new.id,'order_number',new.order_number,'table_number',new.table_number,'status',new.status));
  end if;
  return new;
end;
$$;
revoke execute on function public.queue_order_notification() from public, anon, authenticated;

create function public.cashier_snapshot(p_restaurant uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  start_today timestamptz := date_trunc('day',now() at time zone 'Asia/Baghdad') at time zone 'Asia/Baghdad';
  result jsonb;
begin
  if not public.has_restaurant_role(p_restaurant, array['cashier']::public.member_role[])
    or not public.restaurant_subscription_active(p_restaurant) then
    raise exception 'cashier_required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'orders', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',o.id,'orderNumber',o.order_number,'tableNumber',o.table_number,'customerName',o.customer_name,
      'amount',o.total_amount,'status',o.status,'items',o.items,'notes',o.notes,'createdAt',o.created_at,
      'source',case when o.device_metadata->>'source' in ('cashier','whatsapp') then o.device_metadata->>'source'
        when o.placed_by_waiter then 'staff' else 'menu' end
    ) order by o.created_at,o.id),'[]'::jsonb)
      from public.orders o where o.restaurant_id = p_restaurant and not o.cleared_for_staff
      and o.status in ('pending','preparing','ready')),
    'stats', (select jsonb_build_object(
      'total',count(*),'served',count(*) filter(where o.status='served'),
      'servedValue',coalesce(sum(o.total_amount) filter(where o.status='served'),0))
      from public.orders o where o.restaurant_id = p_restaurant and o.created_at >= start_today)
  ) into result;
  return result;
end;
$$;
revoke execute on function public.cashier_snapshot(uuid) from public, anon;
grant execute on function public.cashier_snapshot(uuid) to authenticated;

-- Shift reset remains an explicitly authorized administrative operation.
-- Its protected restaurant fields cannot be changed by a direct staff update.
create or replace function public.reset_restaurant_shift(p_restaurant_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  if not public.has_restaurant_role(p_restaurant_id,array['owner','manager']::public.member_role[])
    or not public.restaurant_subscription_active(p_restaurant_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  update public.restaurants set current_order_number=0,last_shift_reset_time=floor(extract(epoch from clock_timestamp())*1000)
    where id=p_restaurant_id;
  update public.orders set cleared_for_staff=true where restaurant_id=p_restaurant_id and not cleared_for_staff;
  get diagnostics affected=row_count;
  return affected;
end;
$$;
revoke execute on function public.reset_restaurant_shift(uuid) from public, anon;

commit;
