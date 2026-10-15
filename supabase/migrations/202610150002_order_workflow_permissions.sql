begin;

-- Order numbers restart at 1 after each shift reset. UUIDs remain the durable
-- order identity, so order_number must not be unique across all shifts.
alter table public.orders drop constraint if exists orders_restaurant_id_order_number_key;
create index if not exists orders_restaurant_number_idx on public.orders(restaurant_id,order_number,created_at desc);

-- Operational staff need to read the menu, but only owners/managers may edit it.
drop policy if exists menu_tenant_all on public.menu_items;
drop policy if exists menu_tenant_select on public.menu_items;
drop policy if exists menu_owner_insert on public.menu_items;
drop policy if exists menu_owner_update on public.menu_items;
drop policy if exists menu_owner_delete on public.menu_items;
create policy menu_tenant_select on public.menu_items for select to authenticated
  using (public.is_system_admin() or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id)));
create policy menu_owner_insert on public.menu_items for insert to authenticated
  with check (public.is_system_admin() or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id,array['owner','manager']::public.member_role[])));
create policy menu_owner_update on public.menu_items for update to authenticated
  using (public.is_system_admin() or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id,array['owner','manager']::public.member_role[])))
  with check (public.is_system_admin() or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id,array['owner','manager']::public.member_role[])));
create policy menu_owner_delete on public.menu_items for delete to authenticated
  using (public.is_system_admin() or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id,array['owner','manager']::public.member_role[])));

-- Staff status updates must not modify customer details or tracking credentials.
create or replace function public.enforce_order_update() returns trigger language plpgsql security definer set search_path='' as $$
declare member_role public.member_role; begin
 if public.is_system_admin() then return new; end if;
 select role into member_role from public.restaurant_members where restaurant_id=old.restaurant_id and user_id=auth.uid() and active;
 if member_role is null then raise exception 'unauthorized'; end if;
 if row(new.id,new.restaurant_id,new.customer_name,new.table_number,new.items,new.total_amount,new.notes,new.order_number,new.created_at,new.device_metadata,new.tracking_token_hash,new.placed_by_waiter,new.waiter_name)
    is distinct from
    row(old.id,old.restaurant_id,old.customer_name,old.table_number,old.items,old.total_amount,old.notes,old.order_number,old.created_at,old.device_metadata,old.tracking_token_hash,old.placed_by_waiter,old.waiter_name)
 then raise exception 'immutable_order_fields'; end if;
 if old.status is distinct from new.status then
   if member_role='kitchen' and not ((old.status='preparing' and new.status in ('ready','rejected')) or (old.status='ready' and new.status='preparing') or (old.status='pending' and new.status='preparing')) then raise exception 'invalid_kitchen_transition'; end if;
   if member_role='waiter' and not ((old.status='pending' and new.status in ('preparing','rejected','cancelled')) or (old.status='ready' and new.status='served')) then raise exception 'invalid_waiter_transition'; end if;
 end if; return new; end $$;

commit;
