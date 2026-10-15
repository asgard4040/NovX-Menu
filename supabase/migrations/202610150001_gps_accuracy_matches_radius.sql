begin;

-- A phone's reported accuracy can be wider than 100 m indoors. Keep it no
-- wider than the restaurant's configured radius, with a 150 m absolute cap.
-- Browser GPS is an estimate, not proof that a customer is physically present.
create or replace function public.create_waiter_request(p_restaurant_id uuid,p_customer_name text,p_table_number text,p_reason text,p_lat float8,p_lon float8,p_accuracy float8,p_idempotency_key text) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.restaurants; d float8; rid uuid; begin
 select * into r from public.restaurants where id=p_restaurant_id for share;
 if not public.subscription_active(r) then raise exception 'subscription_inactive'; end if;
 if r.latitude is null or r.longitude is null
    or p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180
    or p_accuracy is null or p_accuracy <= 0 or p_accuracy > least(150.0,r.geofence_radius_meters::float8)
 then raise exception 'location_rejected'; end if;
 d:=public.distance_meters(p_lat,p_lon,r.latitude,r.longitude); if d>r.geofence_radius_meters then raise exception 'location_rejected'; end if;
 select resource_id into rid from public.idempotency_keys where scope='waiter_request' and restaurant_id=r.id and key=p_idempotency_key; if rid is not null then return rid; end if;
 insert into public.waiter_requests(restaurant_id,customer_name,table_number,reason,distance_meters) values(r.id,left(p_customer_name,80),left(p_table_number,30),left(p_reason,300),round(d)) returning id into rid;
 insert into public.idempotency_keys values('waiter_request',r.id,p_idempotency_key,rid,now());
 insert into public.notification_outbox(restaurant_id,event_type,payload) values(r.id,'waiter_request',jsonb_build_object('request_id',rid,'table_number',p_table_number,'reason',p_reason)); return rid; end $$;

create or replace function public.create_customer_order(p_restaurant_id uuid,p_customer_name text,p_table_number text,p_notes text,p_items jsonb,p_lat float8,p_lon float8,p_accuracy float8,p_fingerprint text,p_idempotency_key text,p_tracking_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.restaurants; d float8; oid uuid; n bigint; total numeric:=0; normalized jsonb; begin
 if length(coalesce(p_idempotency_key,''))<20 or length(coalesce(p_tracking_token,''))<20 then raise exception 'invalid_request_token'; end if;
 select * into r from public.restaurants where id=p_restaurant_id for update;
 if not public.subscription_active(r) then raise exception 'subscription_inactive'; end if;
 if r.latitude is null or r.longitude is null
    or p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180
    or p_accuracy is null or p_accuracy <= 0 or p_accuracy > least(150.0,r.geofence_radius_meters::float8)
 then raise exception 'location_rejected'; end if;
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

commit;
