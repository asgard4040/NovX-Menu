begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$ begin create type public.member_role as enum ('owner','manager','waiter','kitchen'); exception when duplicate_object then null; end $$;
do $$ begin create type public.order_status as enum ('pending','preparing','ready','served','cancelled','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type public.request_status as enum ('pending','accepted','completed'); exception when duplicate_object then null; end $$;

create table if not exists public.restaurants (
  id uuid primary key default extensions.gen_random_uuid(), legacy_id text unique,
  manager_name text not null, manager_phone text, restaurant_name text not null, username text not null unique,
  province text, area text, landmark text, status text not null default 'active' check (status in ('active','suspended')),
  subscription_type text not null default 'normal', subscription_duration text not null default 'month',
  start_date timestamptz not null, end_date timestamptz not null,
  grace_period_days integer not null default 3 check (grace_period_days between 0 and 30),
  monthly_cost numeric(14,2) not null default 0, total_cost numeric(14,2) not null default 0,
  logo_url text, province_data jsonb, categories jsonb not null default '[]',
  latitude double precision check (latitude between -90 and 90), longitude double precision check (longitude between -180 and 180),
  geofence_radius_meters integer not null default 150 check (geofence_radius_meters between 25 and 1000),
  current_order_number bigint not null default 0, last_shift_reset_time bigint,
  theme_id text not null default 'italian-luxury', theme_colors jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.restaurant_members (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null, active boolean not null default true,
  created_at timestamptz not null default now(), primary key (restaurant_id,user_id)
);
create table if not exists public.staff (
  id uuid primary key default extensions.gen_random_uuid(), legacy_id text unique,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null, role public.member_role not null check (role in ('waiter','kitchen')),
  name text not null, phone text, username text not null, status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (restaurant_id, username)
);
create table if not exists public.menu_items (
  id uuid primary key default extensions.gen_random_uuid(), legacy_id text unique,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null, price numeric(14,2) not null check (price >= 0), image_url text,
  is_spicy boolean not null default false, has_cheese boolean not null default false,
  cheese_price numeric(14,2) not null default 0 check (cheese_price >= 0), spicy_price numeric(14,2) not null default 0 check (spicy_price >= 0),
  ingredients text, calories numeric, protein numeric, carbs numeric, notes text, category text,
  is_available boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.orders (
  id uuid primary key default extensions.gen_random_uuid(), legacy_id text unique,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_name text not null, table_number text not null, items jsonb not null default '[]', total_amount numeric(14,2) not null check (total_amount >= 0),
  status public.order_status not null default 'pending', notes text, order_number bigint not null,
  created_at timestamptz not null default now(), approved_at timestamptz, ready_at timestamptz,
  cleared_for_staff boolean not null default false, rejected_by text, rejected_role text, rejection_reason text,
  placed_by_waiter boolean not null default false, waiter_name text, device_metadata jsonb not null default '{}',
  tracking_token_hash text not null, updated_at timestamptz not null default now(), unique (restaurant_id,order_number)
);
create table if not exists public.order_items (
  id uuid primary key default extensions.gen_random_uuid(), legacy_key text unique, order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null, item_name text not null,
  quantity integer not null check (quantity between 1 and 99), unit_price numeric(14,2) not null check (unit_price >= 0),
  cheese_selected boolean not null default false, spicy_selected boolean not null default false, customization_text text
);
create table if not exists public.order_status_history (
  id bigint generated always as identity primary key, order_id uuid not null references public.orders(id) on delete cascade,
  old_status public.order_status, new_status public.order_status not null, changed_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.waiter_requests (
  id uuid primary key default extensions.gen_random_uuid(), legacy_id text unique,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_name text not null, table_number text not null, reason text not null, status public.request_status not null default 'pending',
  waiter_id uuid references public.staff(id) on delete set null, waiter_name text, created_at bigint not null default floor(extract(epoch from clock_timestamp())*1000), accepted_at bigint, completed_at bigint,
  distance_meters integer
);
create table if not exists public.security_alerts (
  id uuid primary key default extensions.gen_random_uuid(), legacy_id text unique, restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  type text not null, title text not null, severity text not null check (severity in ('info','warning','critical')),
  customer_name text, table_number text, timestamp bigint not null, device_metadata jsonb not null default '{}', status text not null default 'unread'
);
create table if not exists public.banned_devices (
  id uuid primary key default extensions.gen_random_uuid(), legacy_id text unique, restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  fingerprint text not null, customer_name text, table_number text, banned_by text, reason text not null, banned_at bigint not null, device_type text,
  device_metadata jsonb not null default '{}',
  unique (restaurant_id,fingerprint)
);
create table if not exists public.announcements (
  id uuid primary key default extensions.gen_random_uuid(), legacy_id text unique, target text, target_restaurant_id text,
  target_restaurant_name text, title text not null, message text not null, type text, severity text, created_at timestamptz not null default now()
);
create table if not exists public.app_settings (key text primary key, phone text, logo_url text, model text, prompt text, temperature numeric, updated_at timestamptz not null default now());
create table if not exists public.push_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, endpoint text not null unique, subscription jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.notification_outbox (
  id bigint generated always as identity primary key, restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  event_type text not null, payload jsonb not null, created_at timestamptz not null default now(), processed_at timestamptz, attempts integer not null default 0
);
create table if not exists public.notification_deliveries (
  id bigint generated always as identity primary key, outbox_id bigint not null references public.notification_outbox(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent','expired','failed')),
  attempts integer not null default 0, last_error text, updated_at timestamptz not null default now(),
  unique(outbox_id,subscription_id)
);
create table if not exists public.idempotency_keys (
  scope text not null, restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  key text not null, resource_id uuid not null, created_at timestamptz not null default now(), primary key(scope,restaurant_id,key)
);

create index if not exists orders_restaurant_created_idx on public.orders(restaurant_id,created_at desc);
create index if not exists orders_restaurant_status_idx on public.orders(restaurant_id,status,created_at desc);
create index if not exists menu_items_restaurant_idx on public.menu_items(restaurant_id,category,is_available);
create index if not exists waiter_requests_restaurant_idx on public.waiter_requests(restaurant_id,status,created_at desc);
create index if not exists alerts_restaurant_idx on public.security_alerts(restaurant_id,timestamp desc);
create index if not exists staff_restaurant_idx on public.staff(restaurant_id,role,status);

create or replace function public.is_system_admin() returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((auth.jwt()->'app_metadata'->>'system_role') = 'admin',false)
$$;
create or replace function public.has_restaurant_role(rid uuid, roles public.member_role[] default null) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.restaurant_members m where m.restaurant_id=rid and m.user_id=auth.uid() and m.active and (roles is null or m.role=any(roles)))
$$;
create or replace function public.subscription_active(r public.restaurants, at_time timestamptz default now()) returns boolean language sql stable as $$
  select r.status='active' and at_time >= r.start_date and at_time < r.end_date + make_interval(days=>r.grace_period_days)
$$;
create or replace function public.restaurant_subscription_active(rid uuid, at_time timestamptz default now()) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.subscription_active(r,at_time),false) from public.restaurants r where r.id=rid
$$;
create or replace function public.distance_meters(lat1 float8,lon1 float8,lat2 float8,lon2 float8) returns float8 language sql immutable as $$
  select 6371000*2*asin(sqrt(power(sin(radians(lat2-lat1)/2),2)+cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lon2-lon1)/2),2)))
$$;

alter table public.restaurants enable row level security; alter table public.restaurant_members enable row level security;
alter table public.staff enable row level security; alter table public.menu_items enable row level security; alter table public.orders enable row level security;
alter table public.order_items enable row level security; alter table public.order_status_history enable row level security;
alter table public.waiter_requests enable row level security; alter table public.security_alerts enable row level security;
alter table public.banned_devices enable row level security; alter table public.announcements enable row level security;
alter table public.app_settings enable row level security; alter table public.push_subscriptions enable row level security;
alter table public.notification_outbox enable row level security; alter table public.notification_deliveries enable row level security; alter table public.idempotency_keys enable row level security;

drop policy if exists restaurants_member_select on public.restaurants;
drop policy if exists restaurants_admin_all on public.restaurants;
drop policy if exists restaurants_owner_update on public.restaurants;
drop policy if exists memberships_self_select on public.restaurant_members;
drop policy if exists memberships_admin_write on public.restaurant_members;
drop policy if exists staff_tenant_select on public.staff;
drop policy if exists staff_owner_write on public.staff;
drop policy if exists menu_tenant_all on public.menu_items;
drop policy if exists orders_tenant_select on public.orders;
drop policy if exists orders_tenant_update on public.orders;
drop policy if exists order_items_via_order on public.order_items;
drop policy if exists history_via_order on public.order_status_history;
drop policy if exists requests_tenant_select on public.waiter_requests;
drop policy if exists requests_waiter_update on public.waiter_requests;
drop policy if exists alerts_tenant on public.security_alerts;
drop policy if exists bans_tenant on public.banned_devices;
drop policy if exists announcements_read on public.announcements;
drop policy if exists announcements_admin on public.announcements;
drop policy if exists settings_admin on public.app_settings;
drop policy if exists settings_authenticated_read on public.app_settings;
drop policy if exists push_own on public.push_subscriptions;

create policy restaurants_member_select on public.restaurants for select to authenticated using (public.is_system_admin() or public.has_restaurant_role(id));
create policy restaurants_admin_all on public.restaurants for all to authenticated using (public.is_system_admin()) with check (public.is_system_admin());
create policy restaurants_owner_update on public.restaurants for update to authenticated using (public.has_restaurant_role(id,array['owner','manager']::public.member_role[]) and public.subscription_active(restaurants)) with check (public.has_restaurant_role(id,array['owner','manager']::public.member_role[]));
create policy memberships_self_select on public.restaurant_members for select to authenticated using (user_id=auth.uid() or public.is_system_admin() or public.has_restaurant_role(restaurant_id,array['owner']::public.member_role[]));
create policy memberships_admin_write on public.restaurant_members for all to authenticated using (public.is_system_admin()) with check (public.is_system_admin());
create policy staff_tenant_select on public.staff for select to authenticated using (public.is_system_admin() or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id)));
create policy staff_owner_write on public.staff for all to authenticated using (public.is_system_admin() or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id,array['owner','manager']::public.member_role[]))) with check (public.is_system_admin() or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id,array['owner','manager']::public.member_role[])));
create policy menu_tenant_all on public.menu_items for all to authenticated using (public.is_system_admin() or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id))) with check (public.is_system_admin() or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id,array['owner','manager','waiter']::public.member_role[])));
create policy orders_tenant_select on public.orders for select to authenticated using (public.is_system_admin() or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id)));
create policy orders_tenant_update on public.orders for update to authenticated
  using (
    public.is_system_admin()
    or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id))
  )
  with check (
    public.is_system_admin()
    or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id))
  );
create policy order_items_via_order on public.order_items for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and (public.is_system_admin() or (public.restaurant_subscription_active(o.restaurant_id) and public.has_restaurant_role(o.restaurant_id)))));
create policy history_via_order on public.order_status_history for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and (public.is_system_admin() or (public.restaurant_subscription_active(o.restaurant_id) and public.has_restaurant_role(o.restaurant_id)))));
create policy requests_tenant_select on public.waiter_requests for select to authenticated using (public.is_system_admin() or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id)));
create policy requests_waiter_update on public.waiter_requests for update to authenticated
  using (
    public.is_system_admin()
    or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id,array['owner','manager','waiter']::public.member_role[]))
  )
  with check (
    public.is_system_admin()
    or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id,array['owner','manager','waiter']::public.member_role[]))
  );
create policy alerts_tenant on public.security_alerts for all to authenticated
  using (
    public.is_system_admin()
    or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id))
  )
  with check (
    public.is_system_admin()
    or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id))
  );
create policy bans_tenant on public.banned_devices for all to authenticated
  using (
    public.is_system_admin()
    or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id))
  )
  with check (
    public.is_system_admin()
    or (public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id))
  );
create policy announcements_read on public.announcements for select to authenticated using (true);
create policy announcements_admin on public.announcements for all to authenticated using (public.is_system_admin()) with check (public.is_system_admin());
create policy settings_admin on public.app_settings for all to authenticated using (public.is_system_admin()) with check (public.is_system_admin());
create policy settings_authenticated_read on public.app_settings for select to authenticated using (true);
create policy push_own on public.push_subscriptions for all to authenticated using (user_id=auth.uid() and public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id)) with check (user_id=auth.uid() and public.restaurant_subscription_active(restaurant_id) and public.has_restaurant_role(restaurant_id));

create or replace function public.public_restaurant_menu(p_restaurant_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.restaurants; result jsonb; begin
 select * into r from public.restaurants where id=p_restaurant_id;
 if r.id is null then raise exception 'restaurant_not_found'; end if;
 if not public.subscription_active(r) then raise exception 'subscription_inactive'; end if;
 select jsonb_build_object('restaurant',jsonb_build_object('id',r.id,'restaurant_name',r.restaurant_name,'province',r.province,'area',r.area,'logo_url',r.logo_url,'categories',r.categories,'latitude',r.latitude,'longitude',r.longitude,'geofence_radius_meters',r.geofence_radius_meters,'theme_id',r.theme_id,'theme_colors',r.theme_colors),'menu_items',coalesce(jsonb_agg(to_jsonb(m)) filter(where m.id is not null),'[]')) into result from public.menu_items m where m.restaurant_id=r.id and m.is_available;
 return result; end $$;
grant execute on function public.public_restaurant_menu(uuid) to anon,authenticated;
create or replace function public.resolve_restaurant_id(p_identifier text) returns uuid language sql stable security definer set search_path='' as $$
 select id from public.restaurants where id::text=p_identifier or legacy_id=p_identifier limit 1
$$;
grant execute on function public.resolve_restaurant_id(text) to anon,authenticated;

create or replace function public.public_restaurant_branding(p_restaurant_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'restaurant_name',restaurant_name,'logo_url',logo_url,'status',status) from public.restaurants where id=p_restaurant_id
$$;
grant execute on function public.public_restaurant_branding(uuid) to anon,authenticated;
create or replace function public.customer_device_status(p_restaurant_id uuid,p_fingerprint text) returns jsonb language sql stable security definer set search_path='' as $$
 select case when b.id is null then jsonb_build_object('banned',false) else jsonb_build_object('banned',true,'reason',b.reason) end from (select 1) x left join lateral (select id,reason from public.banned_devices where restaurant_id=p_restaurant_id and fingerprint=p_fingerprint limit 1)b on true
$$;
grant execute on function public.customer_device_status(uuid,text) to anon,authenticated;
create or replace function public.create_security_alert(p_restaurant_id uuid,p_type text,p_title text,p_severity text,p_customer_name text,p_table_number text,p_fingerprint text,p_distance float8) returns void language plpgsql security definer set search_path='' as $$ begin
 if not exists(select 1 from public.restaurants where id=p_restaurant_id) then raise exception 'restaurant_not_found'; end if;
 insert into public.security_alerts(restaurant_id,type,title,severity,customer_name,table_number,timestamp,device_metadata) values(p_restaurant_id,left(p_type,50),left(p_title,300),case when p_severity in('info','warning','critical') then p_severity else 'warning' end,left(p_customer_name,80),left(p_table_number,30),floor(extract(epoch from clock_timestamp())*1000),jsonb_build_object('fingerprint',left(p_fingerprint,128),'distanceMeters',p_distance)); end $$;
grant execute on function public.create_security_alert(uuid,text,text,text,text,text,text,float8) to anon,authenticated;

create or replace function public.create_waiter_request(p_restaurant_id uuid,p_customer_name text,p_table_number text,p_reason text,p_lat float8,p_lon float8,p_accuracy float8,p_idempotency_key text) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.restaurants; d float8; rid uuid; begin
 select * into r from public.restaurants where id=p_restaurant_id for share;
 if not public.subscription_active(r) then raise exception 'subscription_inactive'; end if;
 if r.latitude is null or r.longitude is null or p_accuracy>100 then raise exception 'location_rejected'; end if;
 d:=public.distance_meters(p_lat,p_lon,r.latitude,r.longitude); if d>r.geofence_radius_meters then raise exception 'location_rejected'; end if;
 select resource_id into rid from public.idempotency_keys where scope='waiter_request' and restaurant_id=r.id and key=p_idempotency_key; if rid is not null then return rid; end if;
 insert into public.waiter_requests(restaurant_id,customer_name,table_number,reason,distance_meters) values(r.id,left(p_customer_name,80),left(p_table_number,30),left(p_reason,300),round(d)) returning id into rid;
 insert into public.idempotency_keys values('waiter_request',r.id,p_idempotency_key,rid,now());
 insert into public.notification_outbox(restaurant_id,event_type,payload) values(r.id,'waiter_request',jsonb_build_object('request_id',rid,'table_number',p_table_number,'reason',p_reason)); return rid; end $$;
grant execute on function public.create_waiter_request(uuid,text,text,text,float8,float8,float8,text) to anon,authenticated;

create or replace function public.create_customer_order(p_restaurant_id uuid,p_customer_name text,p_table_number text,p_notes text,p_items jsonb,p_lat float8,p_lon float8,p_accuracy float8,p_fingerprint text,p_idempotency_key text,p_tracking_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.restaurants; d float8; oid uuid; n bigint; total numeric:=0; normalized jsonb; begin
 if length(coalesce(p_idempotency_key,''))<20 or length(coalesce(p_tracking_token,''))<20 then raise exception 'invalid_request_token'; end if;
 select * into r from public.restaurants where id=p_restaurant_id for update;
 if not public.subscription_active(r) then raise exception 'subscription_inactive'; end if;
 if r.latitude is null or r.longitude is null or p_accuracy>100 then raise exception 'location_rejected'; end if;
 d:=public.distance_meters(p_lat,p_lon,r.latitude,r.longitude); if d>r.geofence_radius_meters then raise exception 'location_rejected'; end if;
 select resource_id into oid from public.idempotency_keys where scope='order' and restaurant_id=r.id and key=p_idempotency_key;
 if oid is not null then return (select jsonb_build_object('id',o.id,'order_number',o.order_number,'total_amount',o.total_amount,'status',o.status,'items',o.items,'tracking_token',p_tracking_token) from public.orders o where o.id=oid); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'quantity',greatest(1,least(99,(x->>'quantity')::int)),'price',m.price + case when coalesce((x->>'cheeseSelected')::boolean,false) then m.cheese_price else 0 end + case when coalesce((x->>'spicySelected')::boolean,false) then m.spicy_price else 0 end,'cheeseSelected',coalesce((x->>'cheeseSelected')::boolean,false),'spicySelected',coalesce((x->>'spicySelected')::boolean,false))),'[]'),coalesce(sum((m.price + case when coalesce((x->>'cheeseSelected')::boolean,false) then m.cheese_price else 0 end + case when coalesce((x->>'spicySelected')::boolean,false) then m.spicy_price else 0 end)*greatest(1,least(99,(x->>'quantity')::int))),0) into normalized,total from jsonb_array_elements(p_items) x join public.menu_items m on m.id=(x->>'id')::uuid and m.restaurant_id=r.id and m.is_available;
 if jsonb_array_length(normalized)<>jsonb_array_length(p_items) or jsonb_array_length(normalized)=0 then raise exception 'invalid_menu_item'; end if;
 n:=r.current_order_number+1; update public.restaurants set current_order_number=n where id=r.id;
 insert into public.orders(restaurant_id,customer_name,table_number,items,total_amount,notes,order_number,device_metadata,tracking_token_hash) values(r.id,left(p_customer_name,80),left(p_table_number,30),normalized,total,left(p_notes,500),n,jsonb_build_object('fingerprint',left(p_fingerprint,128),'distanceMeters',round(d)),encode(extensions.digest(p_tracking_token,'sha256'::text),'hex')) returning id into oid;
 insert into public.order_items(order_id,menu_item_id,item_name,quantity,unit_price,cheese_selected,spicy_selected) select oid,(x->>'id')::uuid,x->>'name',(x->>'quantity')::int,(x->>'price')::numeric,coalesce((x->>'cheeseSelected')::boolean,false),coalesce((x->>'spicySelected')::boolean,false) from jsonb_array_elements(normalized)x;
 insert into public.idempotency_keys values('order',r.id,p_idempotency_key,oid,now());
 return jsonb_build_object('id',oid,'order_number',n,'total_amount',total,'status','pending','items',normalized,'tracking_token',p_tracking_token); end $$;
grant execute on function public.create_customer_order(uuid,text,text,text,jsonb,float8,float8,float8,text,text,text) to anon,authenticated;

create or replace function public.create_staff_order(p_restaurant_id uuid,p_customer_name text,p_table_number text,p_notes text,p_items jsonb,p_waiter_name text,p_idempotency_key text) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.restaurants; oid uuid; n bigint; total numeric; normalized jsonb; begin
 if not public.has_restaurant_role(p_restaurant_id,array['owner','manager','waiter']::public.member_role[]) then raise exception 'unauthorized'; end if;
 select * into r from public.restaurants where id=p_restaurant_id for update; if not public.subscription_active(r) then raise exception 'subscription_inactive'; end if;
 if length(coalesce(p_idempotency_key,''))<20 then raise exception 'invalid_idempotency_key'; end if;
 select resource_id into oid from public.idempotency_keys where scope='staff_order' and restaurant_id=r.id and key=p_idempotency_key; if oid is not null then return oid; end if;
 select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'quantity',greatest(1,least(99,(x->>'quantity')::int)),'price',m.price)),sum(m.price*greatest(1,least(99,(x->>'quantity')::int))) into normalized,total from jsonb_array_elements(p_items)x join public.menu_items m on m.id=(x->>'id')::uuid and m.restaurant_id=r.id and m.is_available;
 if normalized is null or jsonb_array_length(normalized)<>jsonb_array_length(p_items) then raise exception 'invalid_menu_item'; end if;
 n:=r.current_order_number+1; update public.restaurants set current_order_number=n where id=r.id;
 insert into public.orders(restaurant_id,customer_name,table_number,items,total_amount,status,notes,order_number,placed_by_waiter,waiter_name,approved_at,tracking_token_hash) values(r.id,left(p_customer_name,80),left(p_table_number,30),normalized,total,'preparing',left(p_notes,500),n,true,left(p_waiter_name,80),now(),encode(extensions.digest(extensions.gen_random_uuid()::text,'sha256'::text),'hex')) returning id into oid;
 insert into public.order_items(order_id,menu_item_id,item_name,quantity,unit_price) select oid,(x->>'id')::uuid,x->>'name',(x->>'quantity')::int,(x->>'price')::numeric from jsonb_array_elements(normalized)x;
 insert into public.idempotency_keys values('staff_order',r.id,p_idempotency_key,oid,now()); return oid; end $$;
grant execute on function public.create_staff_order(uuid,text,text,text,jsonb,text,text) to authenticated;
create or replace function public.reset_restaurant_shift(p_restaurant_id uuid) returns integer language plpgsql security invoker set search_path='' as $$ declare affected integer; begin
 if not public.has_restaurant_role(p_restaurant_id,array['owner','manager']::public.member_role[]) then raise exception 'unauthorized'; end if;
 update public.restaurants set current_order_number=0,last_shift_reset_time=floor(extract(epoch from clock_timestamp())*1000) where id=p_restaurant_id;
 update public.orders set cleared_for_staff=true where restaurant_id=p_restaurant_id and not cleared_for_staff; get diagnostics affected=row_count; return affected; end $$;
grant execute on function public.reset_restaurant_shift(uuid) to authenticated;

create or replace function public.track_order(p_order_id uuid,p_tracking_token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'status',status,'order_number',order_number,'total_amount',total_amount,'items',items,'rejection_reason',rejection_reason) from public.orders where id=p_order_id and tracking_token_hash=encode(extensions.digest(p_tracking_token,'sha256'::text),'hex')
$$;
grant execute on function public.track_order(uuid,text) to anon,authenticated;

create or replace function public.audit_order_status() returns trigger language plpgsql security definer set search_path='' as $$ begin if old.status is distinct from new.status then insert into public.order_status_history(order_id,old_status,new_status,changed_by) values(new.id,old.status,new.status,auth.uid()); end if; new.updated_at=now(); return new; end $$;
drop trigger if exists orders_status_audit on public.orders;
create trigger orders_status_audit before update on public.orders for each row execute function public.audit_order_status();
create or replace function public.enforce_order_update() returns trigger language plpgsql security definer set search_path='' as $$
declare member_role public.member_role; begin
 if public.is_system_admin() then return new; end if;
 select role into member_role from public.restaurant_members where restaurant_id=old.restaurant_id and user_id=auth.uid() and active;
 if member_role is null then raise exception 'unauthorized'; end if;
 if new.restaurant_id<>old.restaurant_id or new.total_amount<>old.total_amount or new.items<>old.items or new.order_number<>old.order_number then raise exception 'immutable_order_fields'; end if;
 if old.status is distinct from new.status then
   if member_role='kitchen' and not ((old.status='preparing' and new.status in ('ready','rejected')) or (old.status='ready' and new.status='preparing') or (old.status='pending' and new.status='preparing')) then raise exception 'invalid_kitchen_transition'; end if;
   if member_role='waiter' and not ((old.status='pending' and new.status in ('preparing','rejected','cancelled')) or (old.status='ready' and new.status='served')) then raise exception 'invalid_waiter_transition'; end if;
 end if; return new; end $$;
drop trigger if exists orders_enforce_update on public.orders;
create trigger orders_enforce_update before update on public.orders for each row execute function public.enforce_order_update();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('restaurant-assets','restaurant-assets',true,5242880,array['image/jpeg','image/png','image/webp','image/svg+xml']) on conflict(id) do nothing;
drop policy if exists assets_public_read on storage.objects;
drop policy if exists assets_admin_all on storage.objects;
drop policy if exists assets_member_insert on storage.objects;
drop policy if exists assets_member_update on storage.objects;
drop policy if exists assets_member_delete on storage.objects;
create policy assets_public_read on storage.objects for select using(bucket_id='restaurant-assets');
create policy assets_admin_all on storage.objects for all to authenticated using(bucket_id='restaurant-assets' and public.is_system_admin()) with check(bucket_id='restaurant-assets' and public.is_system_admin());
create policy assets_member_insert on storage.objects for insert to authenticated with check(bucket_id='restaurant-assets' and public.restaurant_subscription_active((storage.foldername(name))[1]::uuid) and public.has_restaurant_role((storage.foldername(name))[1]::uuid,array['owner','manager']::public.member_role[]));
create policy assets_member_update on storage.objects for update to authenticated using(bucket_id='restaurant-assets' and public.restaurant_subscription_active((storage.foldername(name))[1]::uuid) and public.has_restaurant_role((storage.foldername(name))[1]::uuid,array['owner','manager']::public.member_role[]));
create policy assets_member_delete on storage.objects for delete to authenticated using(bucket_id='restaurant-assets' and public.restaurant_subscription_active((storage.foldername(name))[1]::uuid) and public.has_restaurant_role((storage.foldername(name))[1]::uuid,array['owner','manager']::public.member_role[]));
do $$
declare table_name text;
begin
  foreach table_name in array array['orders','waiter_requests','menu_items','security_alerts','banned_devices','restaurants','staff','announcements'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I',table_name);
    end if;
  end loop;
end $$;
commit;
