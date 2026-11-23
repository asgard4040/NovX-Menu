begin;

-- Restaurant staff may edit operational settings. Billing and lifecycle
-- fields are maintained by administrators and privileged backend workflows.
create function ordova_private.guard_restaurant_settings()
returns trigger language plpgsql set search_path = '' as $$
declare
  editable constant text[] := array[
    'categories', 'latitude', 'longitude', 'geofence_radius_meters',
    'logo_url', 'theme_id', 'theme_colors', 'table_count', 'qr_design', 'updated_at'
  ];
begin
  if current_user in ('anon', 'authenticated')
    and not public.is_system_admin()
    and (to_jsonb(new) - editable) is distinct from (to_jsonb(old) - editable) then
    raise exception 'restaurant_settings_forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function ordova_private.guard_restaurant_settings() from public;
create trigger guard_restaurant_settings before update on public.restaurants
for each row execute function ordova_private.guard_restaurant_settings();

-- Keep a fresh installation aligned with the range shown in the owner UI.
alter table public.restaurants drop constraint restaurants_geofence_radius_meters_check;
alter table public.restaurants add constraint restaurants_geofence_radius_meters_check
  check (geofence_radius_meters between 10 and 1000);

-- Guest writes go through the validated, shared limits in the Express API.
revoke execute on function
  public.create_customer_order(uuid,text,text,text,jsonb,float8,float8,float8,text,text,text),
  public.create_waiter_request(uuid,text,text,text,float8,float8,float8,text),
  public.create_security_alert(uuid,text,text,text,text,text,text,float8)
from public, anon, authenticated;
grant execute on function
  public.create_customer_order(uuid,text,text,text,jsonb,float8,float8,float8,text,text,text),
  public.create_waiter_request(uuid,text,text,text,float8,float8,float8,text),
  public.create_security_alert(uuid,text,text,text,text,text,text,float8)
to service_role;

revoke execute on function public.create_staff_order(uuid,text,text,text,jsonb,text,text) from public, anon;
revoke execute on function public.audit_order_status(), public.enforce_order_update(),
  public.dispatch_notification_soon(), public.queue_order_notification()
from public, anon, authenticated;

alter function public.subscription_active(public.restaurants,timestamptz) set search_path = '';
alter function public.distance_meters(float8,float8,float8,float8) set search_path = '';

-- Staff interfaces read support branding. Provider instructions and billing
-- configuration are fetched by administrator sessions or the server.
alter policy settings_authenticated_read on public.app_settings using (key = 'support');

-- Serialize retries for one waiter call without blocking other tables.
create or replace function public.create_waiter_request(
  p_restaurant_id uuid, p_customer_name text, p_table_number text, p_reason text,
  p_lat float8, p_lon float8, p_accuracy float8, p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  restaurant public.restaurants;
  distance float8;
  request_id uuid;
begin
  if length(coalesce(p_idempotency_key,'')) not between 20 and 200 then
    raise exception 'invalid_request_token';
  end if;
  select * into restaurant from public.restaurants where id = p_restaurant_id for share;
  if not coalesce(public.subscription_active(restaurant), false) then
    raise exception 'subscription_inactive';
  end if;
  if restaurant.latitude is null or restaurant.longitude is null
    or p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180
    or p_accuracy is null or p_accuracy <= 0
    or p_accuracy > least(150.0, restaurant.geofence_radius_meters::float8) then
    raise exception 'location_rejected';
  end if;
  distance := public.distance_meters(p_lat, p_lon, restaurant.latitude, restaurant.longitude);
  if distance > restaurant.geofence_radius_meters then raise exception 'location_rejected'; end if;

  perform pg_advisory_xact_lock(hashtextextended('waiter_request:' || restaurant.id::text || ':' || p_idempotency_key, 0));
  select resource_id into request_id from public.idempotency_keys
  where scope = 'waiter_request' and restaurant_id = restaurant.id and key = p_idempotency_key;
  if request_id is not null then return request_id; end if;

  insert into public.waiter_requests(restaurant_id, customer_name, table_number, reason, distance_meters)
  values(restaurant.id, left(p_customer_name,80), left(p_table_number,30), left(p_reason,300), round(distance))
  returning id into request_id;
  insert into public.idempotency_keys values('waiter_request', restaurant.id, p_idempotency_key, request_id, now());
  insert into public.notification_outbox(restaurant_id, event_type, payload)
  values(restaurant.id, 'waiter_request', jsonb_build_object(
    'request_id', request_id, 'table_number', left(p_table_number,30), 'reason', left(p_reason,300)));
  return request_id;
end;
$$;

create function ordova_private.guard_customer_order_device()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.banned_devices
    where restaurant_id = new.restaurant_id and fingerprint = new.device_metadata->>'fingerprint'
  ) then
    raise exception 'device_banned' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function ordova_private.guard_customer_order_device() from public;
create trigger guard_customer_order_device before insert on public.orders
for each row when (new.device_metadata ? 'fingerprint')
execute function ordova_private.guard_customer_order_device();

commit;
