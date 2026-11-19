begin;

create table public.whatsapp_settings (
  restaurant_id uuid primary key references public.restaurants on delete cascade,
  enabled boolean not null default false,
  ordering_enabled boolean not null default false,
  welcome text not null default '' check (length(welcome) <= 300),
  language text not null default 'ar' check (language in ('ar','en')),
  tone text not null default 'friendly' check (tone in ('friendly','formal')),
  timezone text not null default 'Asia/Baghdad' check (timezone in ('Asia/Baghdad','UTC')),
  opens_at time,
  closes_at time,
  handoff_enabled boolean not null default true,
  daily_ai_limit integer not null default 150 check (daily_ai_limit between 1 and 500),
  check ((opens_at is null and closes_at is null) or
         (opens_at is not null and closes_at is not null and opens_at <> closes_at))
);

create table public.whatsapp_accounts (
  phone_id text not null check (phone_id ~ '^[0-9]{5,32}$'),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  waba_id text not null check (waba_id ~ '^[0-9]{5,32}$'),
  display_phone text not null,
  token_ciphertext text,
  token_expires_at timestamptz,
  data_access_expires_at timestamptz,
  status text not null check (status in ('connecting','connected','disconnecting','disconnected','reconnect_required')),
  subscribed boolean not null default false,
  coexistence boolean not null default false,
  last_error text,
  verified_at timestamptz,
  last_webhook_at timestamptz,
  onboarding_id uuid,
  operation_at timestamptz not null default now(),
  primary key (restaurant_id, phone_id)
);
create unique index whatsapp_one_active_number on public.whatsapp_accounts(restaurant_id) where status <> 'disconnected';
create unique index whatsapp_one_active_phone on public.whatsapp_accounts(phone_id) where status <> 'disconnected';
create index whatsapp_accounts_active_waba on public.whatsapp_accounts(waba_id) where status <> 'disconnected';

create table public.whatsapp_signup (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes',
  used_at timestamptz,
  token_ciphertext text,
  unique (id, restaurant_id)
);
create index whatsapp_signup_owner on public.whatsapp_signup(restaurant_id,user_id,expires_at);

create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  phone_id text not null,
  customer_id text not null check (customer_id ~ '^([0-9]{5,24}|[A-Z]{2}[.][A-Za-z0-9]{1,128})$'),
  last_inbound_at timestamptz not null,
  processed_at timestamptz,
  draft jsonb not null default '[]',
  quote jsonb,
  quote_id uuid,
  quote_expires_at timestamptz,
  locale text not null default 'ar' check (locale in ('ar','en')),
  handoff boolean not null default false,
  foreign key (restaurant_id,phone_id) references public.whatsapp_accounts(restaurant_id,phone_id) on delete cascade,
  unique(restaurant_id,phone_id,customer_id),
  unique(restaurant_id,id)
);
create index whatsapp_conversations_recent on public.whatsapp_conversations(restaurant_id,last_inbound_at desc);

create table public.whatsapp_jobs (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  restaurant_id uuid not null,
  conversation_id uuid not null,
  direction text not null check (direction in ('in','out')),
  kind text not null,
  dedupe_key text not null,
  payload jsonb not null,
  occurred_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  run_at timestamptz not null default clock_timestamp(),
  lease uuid,
  attempts integer not null default 0,
  state text not null default 'queued' check (state in (
    'queued','processing','sending','done','accepted','sent','delivered','read','failed','blocked','uncertain','skipped'
  )),
  provider_id text,
  provider_at timestamptz,
  error_code text,
  foreign key(restaurant_id,conversation_id) references public.whatsapp_conversations(restaurant_id,id) on delete cascade,
  unique(conversation_id,direction,dedupe_key)
);
create index whatsapp_jobs_due on public.whatsapp_jobs(direction,run_at,seq)
  where state in ('queued','processing','sending');
create index whatsapp_jobs_queue on public.whatsapp_jobs(conversation_id,direction,occurred_at,seq)
  where state in ('queued','processing','sending');
create index whatsapp_jobs_ingress_rate on public.whatsapp_jobs(conversation_id,created_at desc) where direction='in';
create index whatsapp_jobs_history on public.whatsapp_jobs(restaurant_id,conversation_id,seq desc);
create index whatsapp_jobs_provider on public.whatsapp_jobs(provider_id) where provider_id is not null;

alter table public.orders add constraint orders_restaurant_order_unique unique (restaurant_id,id);

create table public.whatsapp_orders (
  order_id uuid primary key,
  restaurant_id uuid not null,
  conversation_id uuid,
  quote_id uuid not null unique,
  created_at timestamptz not null default now(),
  foreign key(restaurant_id,conversation_id) references public.whatsapp_conversations(restaurant_id,id) on delete set null (conversation_id),
  foreign key(restaurant_id,order_id) references public.orders(restaurant_id,id) on delete cascade
);
create index whatsapp_orders_recent on public.whatsapp_orders(restaurant_id,created_at desc);
create index whatsapp_orders_conversation on public.whatsapp_orders(conversation_id,created_at desc);

create table public.whatsapp_usage (
  job_id uuid not null references public.whatsapp_jobs on delete cascade,
  attempt integer not null,
  restaurant_id uuid not null references public.restaurants on delete cascade,
  conversation_id uuid not null,
  created_at timestamptz not null default now(),
  model text not null,
  input_tokens integer,
  output_tokens integer,
  estimated_usd numeric(16,8),
  primary key(job_id,attempt),
  foreign key(restaurant_id,conversation_id) references public.whatsapp_conversations(restaurant_id,id) on delete cascade
);
create index whatsapp_usage_period on public.whatsapp_usage(restaurant_id,created_at);
create index whatsapp_usage_conversation on public.whatsapp_usage(restaurant_id,conversation_id,created_at);

-- The authenticated owner API checks live membership before accessing these
-- tables. Deny direct Data API access, including to ciphertext and payloads.
do $$
declare relation text;
begin
  foreach relation in array array['settings','accounts','signup','conversations','jobs','orders','usage'] loop
    execute format('alter table public.whatsapp_%I enable row level security',relation);
    execute format('revoke all on public.whatsapp_%I from public,anon,authenticated',relation);
    execute format('grant select,insert,update,delete on public.whatsapp_%I to service_role',relation);
  end loop;
end $$;
grant usage,select on sequence public.whatsapp_jobs_seq_seq to service_role;

create function public.whatsapp_open(p_restaurant uuid, p_at timestamptz default now())
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select case
    when s.opens_at is null then true
    when s.opens_at < s.closes_at then local_time >= s.opens_at and local_time < s.closes_at
    else local_time >= s.opens_at or local_time < s.closes_at end
  from public.whatsapp_settings s
  cross join lateral (select (p_at at time zone s.timezone)::time as local_time) t
  where s.restaurant_id = p_restaurant),true)
$$;

-- The trusted mapping validates BOTH Meta identifiers before consulting a conversation.
create function public.whatsapp_ingest(p_events jsonb) returns integer
language plpgsql set search_path = '' as $$
declare e jsonb; a public.whatsapp_accounts; cid uuid; received timestamptz; count_inserted integer := 0;
begin
  for e in select value from jsonb_array_elements(p_events) loop
    received := to_timestamp((e->>'time')::bigint);
    if received < now() - interval '7 days' or received > now() + interval '5 minutes' then continue; end if;
    if e->>'kind'='revoked' then
      update public.whatsapp_accounts
      set status='reconnect_required',subscribed=false,token_ciphertext=null,verified_at=null,
        last_webhook_at=now(),last_error='meta_access_revoked'
      where waba_id=e->>'waba' and status='connected' and received>=date_trunc('second',operation_at);
      continue;
    end if;
    select * into a from public.whatsapp_accounts
    where phone_id=e->>'phone' and waba_id=e->>'waba' and status='connected' and subscribed;
    if not found then continue; end if;
    if received < date_trunc('second',a.operation_at) and e->>'kind' <> 'status' then continue; end if;
    if e->>'kind' = 'status' then
      update public.whatsapp_jobs j
      set provider_id=coalesce(j.provider_id,e->>'provider_id'), state=e->>'status', provider_at=received,
          error_code=case when e->>'status'='failed' then coalesce(e->>'error','delivery_failed') end,
          lease=null
      from public.whatsapp_conversations c
      where j.conversation_id=c.id and j.restaurant_id=a.restaurant_id and c.phone_id=a.phone_id and j.direction='out'
        and ((j.provider_id=e->>'provider_id') or (j.id::text=e->>'opaque' and j.provider_id is null))
        and j.state in ('sending','uncertain','accepted','sent','delivered','read','failed')
        and (received>=coalesce(j.provider_at,'-infinity') or e->>'status' in ('delivered','read'))
        and case e->>'status'
          when 'sent' then j.state in ('sending','uncertain','accepted')
          when 'failed' then j.state in ('sending','uncertain','accepted','sent','failed') and received>=coalesce(j.provider_at,'-infinity')
          when 'delivered' then j.state <> 'read'
          when 'read' then true else false end;
      continue;
    end if;
    if e->>'kind'='identity' then
      update public.whatsapp_conversations c
      set customer_id=e->>'customer',quote_id=null,quote=null,quote_expires_at=null
      where c.restaurant_id=a.restaurant_id and c.phone_id=a.phone_id and c.customer_id=e->>'previous_customer' and received>=c.last_inbound_at
        and not exists (select 1 from public.whatsapp_conversations current
          where current.restaurant_id=a.restaurant_id and current.phone_id=a.phone_id and current.customer_id=e->>'customer');
      continue;
    end if;
    if received < now() - interval '24 hours' then continue; end if;
    if e->>'customer_phone' is not null and e->>'customer' <> e->>'customer_phone' then
      -- A signed inbound carrying both identifiers can upgrade a legacy phone-only conversation.
      update public.whatsapp_conversations c set customer_id=e->>'customer'
      where c.restaurant_id=a.restaurant_id and c.phone_id=a.phone_id and c.customer_id=e->>'customer_phone'
        and not exists (select 1 from public.whatsapp_conversations current
          where current.restaurant_id=a.restaurant_id and current.phone_id=a.phone_id and current.customer_id=e->>'customer');
    end if;
    insert into public.whatsapp_conversations(restaurant_id,phone_id,customer_id,last_inbound_at)
    values(a.restaurant_id,a.phone_id,e->>'customer',least(now(),received))
    on conflict(restaurant_id,phone_id,customer_id) do update set
      last_inbound_at=greatest(whatsapp_conversations.last_inbound_at,excluded.last_inbound_at)
    returning id into cid;
    -- Queue a limited burst per customer, including terminal jobs in the count.
    if (select count(*) from public.whatsapp_jobs where conversation_id=cid and direction='in'
        and created_at>=now()-interval '1 minute') >= 15 then continue; end if;
    insert into public.whatsapp_jobs(restaurant_id,conversation_id,direction,kind,dedupe_key,payload,occurred_at,run_at)
    values(a.restaurant_id,cid,'in',e->>'kind',e->>'provider_id',e-'waba'-'phone'-'customer'-'customer_phone'-'time'-'provider_id',
      received,now()+interval '2 seconds')
    on conflict do nothing;
    if found then count_inserted := count_inserted+1; end if;
  end loop;
  -- Bound writes for health telemetry by recording the last actual inbound/status batch.
  update public.whatsapp_accounts account set last_webhook_at=now()
  where account.status='connected' and (account.last_webhook_at is null or account.last_webhook_at < now()-interval '15 seconds')
    and exists(select 1 from jsonb_array_elements(p_events) x where x->>'phone'=account.phone_id and x->>'waba'=account.waba_id);
  return count_inserted;
end $$;

create function public.whatsapp_claim(p_direction text,p_limit integer)
returns setof public.whatsapp_jobs language plpgsql set search_path = '' as $$
begin
  update public.whatsapp_jobs set state=case when state='sending' then 'uncertain' else 'failed' end,
    lease=null,error_code=case when state='sending' then 'send_outcome_unknown' else 'attempts_exhausted' end
  where direction=p_direction and run_at<=now()
    and (state='sending' or (attempts>=5 and state in ('queued','processing')));
  return query
  update public.whatsapp_jobs j set state='processing',lease=gen_random_uuid(),
    attempts=j.attempts+1,run_at=now()+interval '90 seconds'
  where j.id in (
    select q.id from public.whatsapp_jobs q
    where q.direction=p_direction and q.state in ('queued','processing') and q.attempts<5 and q.run_at<=now()
      and not exists(select 1 from public.whatsapp_jobs older
        where older.conversation_id=q.conversation_id and older.direction=q.direction
          and older.state in ('queued','processing','sending') and (
           (p_direction='in' and (older.occurred_at,older.seq)<(q.occurred_at,q.seq))
           or (p_direction='out' and older.seq<q.seq)
           or (older.state in ('processing','sending') and older.id<>q.id and older.run_at>now())
          ))
    order by q.run_at,q.seq limit least(greatest(p_limit,1),20) for update of q skip locked
  ) returning j.*;
end $$;

create function public.whatsapp_reserve_ai(p_job uuid,p_lease uuid,p_model text)
returns boolean language plpgsql set search_path = '' as $$
declare j public.whatsapp_jobs; s public.whatsapp_settings;
begin
  select * into j from public.whatsapp_jobs where id=p_job and lease=p_lease and state='processing'
    and direction='in' and run_at>now() for update;
  if not found then return false; end if;
  select * into s from public.whatsapp_settings where restaurant_id=j.restaurant_id for update;
  if not found or not s.enabled then return false; end if;
  if (select count(*) from public.whatsapp_usage where restaurant_id=j.restaurant_id
      and created_at>=date_trunc('day',now(),'UTC')) >= s.daily_ai_limit
     or (select count(*) from public.whatsapp_usage where restaurant_id=j.restaurant_id
      and created_at>=now()-interval '1 minute') >= 30 then return false; end if;
  insert into public.whatsapp_usage(job_id,attempt,restaurant_id,conversation_id,model)
  values(j.id,j.attempts,j.restaurant_id,j.conversation_id,p_model) on conflict do nothing;
  return found;
end $$;

-- Shared customer order internals. The QR entry point retains its geofence
-- and request-token checks. WhatsApp has its own verified confirmation boundary.
create schema if not exists ordova_private;
revoke all on schema ordova_private from public,anon,authenticated;
grant usage on schema ordova_private to service_role;

create function ordova_private.price_customer_order(p_restaurant uuid,p_items jsonb)
returns jsonb language sql set search_path = '' as $$
  with lines as (
    select m.id,m.name,x.ordinality,
      greatest(1,least(99,(x.item->>'quantity')::int)) as quantity,
      coalesce((x.item->>'cheeseSelected')::boolean,false) as cheese,
      coalesce((x.item->>'spicySelected')::boolean,false) as spicy,
      m.price + case when coalesce((x.item->>'cheeseSelected')::boolean,false) then m.cheese_price else 0 end
        + case when coalesce((x.item->>'spicySelected')::boolean,false) then m.spicy_price else 0 end as price
    from jsonb_array_elements(p_items) with ordinality as x(item,ordinality)
    join public.menu_items m on m.id=(x.item->>'id')::uuid and m.restaurant_id=p_restaurant and m.is_available
  )
  select jsonb_build_object(
    'items',jsonb_agg(jsonb_build_object('id',id,'name',name,'quantity',quantity,
      'price',price,'cheeseSelected',cheese,'spicySelected',spicy) order by ordinality),
    'total',sum(price*quantity))
  from lines having count(*)>0 and count(*)=jsonb_array_length(p_items)
$$;

create function ordova_private.insert_pending_order(
  p_restaurant uuid,p_customer text,p_table text,p_notes text,p_price jsonb,p_metadata jsonb,p_tracking text
) returns public.orders language plpgsql set search_path = '' as $$
declare created public.orders; n bigint;
begin
  update public.restaurants set current_order_number=current_order_number+1 where id=p_restaurant
    returning current_order_number into strict n;
  insert into public.orders(restaurant_id,customer_name,table_number,items,total_amount,notes,order_number,device_metadata,tracking_token_hash)
  values(p_restaurant,left(p_customer,80),left(p_table,30),p_price->'items',(p_price->>'total')::numeric,left(p_notes,500),n,
    p_metadata,encode(sha256(convert_to(p_tracking,'UTF8')),'hex')) returning * into created;
  insert into public.order_items(order_id,menu_item_id,item_name,quantity,unit_price,cheese_selected,spicy_selected)
  select created.id,(x->>'id')::uuid,x->>'name',(x->>'quantity')::int,(x->>'price')::numeric,
    (x->>'cheeseSelected')::boolean,(x->>'spicySelected')::boolean from jsonb_array_elements(created.items) x;
  return created;
end $$;

revoke execute on function ordova_private.price_customer_order(uuid,jsonb),
  ordova_private.insert_pending_order(uuid,text,text,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function ordova_private.price_customer_order(uuid,jsonb),
  ordova_private.insert_pending_order(uuid,text,text,text,jsonb,jsonb,text) to service_role;

create or replace function public.create_customer_order(p_restaurant_id uuid,p_customer_name text,p_table_number text,p_notes text,p_items jsonb,p_lat float8,p_lon float8,p_accuracy float8,p_fingerprint text,p_idempotency_key text,p_tracking_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.restaurants; d float8; oid uuid; priced jsonb; created public.orders; begin
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
 priced := ordova_private.price_customer_order(r.id,p_items);
 if priced is null then raise exception 'invalid_menu_item'; end if;
 select * into created from ordova_private.insert_pending_order(
   r.id,p_customer_name,p_table_number,p_notes,priced,
   jsonb_build_object('fingerprint',left(p_fingerprint,128),'distanceMeters',round(d)),p_tracking_token);
 insert into public.idempotency_keys values('order',r.id,p_idempotency_key,created.id,now());
 return jsonb_build_object('id',created.id,'order_number',created.order_number,
   'total_amount',created.total_amount,'status',created.status,'items',created.items,'tracking_token',p_tracking_token);
end $$;

-- Apply the WhatsApp cart limits and validate supported modifiers before using
-- the same pricing calculation as the QR customer entry point.
create function public.whatsapp_price(p_restaurant uuid,p_items jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare priced jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then return null; end if;
  if jsonb_array_length(p_items) not between 1 and 12 then return null; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where
    coalesce(x->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(x->'quantity') is distinct from 'number' or coalesce(x->>'quantity','') !~ '^([1-9]|1[0-9]|20)$'
    or jsonb_typeof(x->'cheeseSelected') is distinct from 'boolean'
    or jsonb_typeof(x->'spicySelected') is distinct from 'boolean') then return null; end if;
  perform 1 from public.menu_items m where m.restaurant_id=p_restaurant
    and m.id in (select (x->>'id')::uuid from jsonb_array_elements(p_items) x)
    order by m.id for share;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    join public.menu_items m on m.id=(x->>'id')::uuid and m.restaurant_id=p_restaurant
    where ((x->>'cheeseSelected')::boolean and not m.has_cheese)
      or ((x->>'spicySelected')::boolean and not m.is_spicy)
  ) then return null; end if;
  priced := ordova_private.price_customer_order(p_restaurant,p_items);
  if (priced->>'total')::numeric > 999999999999.99 then return null; end if;
  return priced;
end $$;

create function public.whatsapp_complete(
  p_job uuid,p_lease uuid,p_locale text,p_action text,p_draft jsonb,p_quote_id uuid,p_quote jsonb,p_reply jsonb
) returns text language plpgsql set search_path = '' as $$
declare j public.whatsapp_jobs; c public.whatsapp_conversations; a public.whatsapp_accounts;
  s public.whatsapp_settings; r public.restaurants; priced jsonb; oid uuid; created public.orders; result text := 'done';
begin
  select * into j from public.whatsapp_jobs where id=p_job and lease=p_lease and direction='in'
    and state='processing' and run_at>now() for update;
  if not found then return 'lease_lost'; end if;
  select * into c from public.whatsapp_conversations where id=j.conversation_id for update;
  if p_action in ('quote','confirm') then
    select * into r from public.restaurants where id=j.restaurant_id for update;
  end if;
  select * into a from public.whatsapp_accounts where restaurant_id=c.restaurant_id and phone_id=c.phone_id for share;
  select * into s from public.whatsapp_settings where restaurant_id=j.restaurant_id for share;
  if a.status is distinct from 'connected' or not a.subscribed
      or a.token_expires_at<=now() or a.data_access_expires_at<=now() or not coalesce(s.enabled,false) or not public.restaurant_subscription_active(j.restaurant_id)
      or j.occurred_at < date_trunc('second',a.operation_at)
      or j.occurred_at < now()-interval '24 hours' or j.occurred_at < c.processed_at
      or (c.handoff and p_action<>'skip') then
    p_action := 'skip';
  end if;
  if p_action in ('quote','confirm') then
    if not s.ordering_enabled or not public.whatsapp_open(r.id) or not public.subscription_active(r) then return 'ordering_closed'; end if;
    if p_action='confirm' then
      if c.quote_id is null or p_quote_id is distinct from c.quote_id or c.quote_expires_at<=now()
        or not exists(select 1 from public.whatsapp_jobs oq
          where oq.conversation_id=c.id and oq.direction='out' and oq.dedupe_key='quote:'||c.quote_id::text
            and oq.created_at>=a.operation_at
            and (oq.state in ('accepted','sent','delivered','read') or
              (oq.state in ('sending','uncertain') and j.kind='button' and j.payload->>'button'='confirm:'||c.quote_id::text)))
        then return 'confirmation_expired'; end if;
      -- The order boundary independently checks that the leased inbound is an
      -- explicit response bound to this exact quote. Tool output cannot confirm.
      if not (
        coalesce(j.kind='button' and j.payload->>'button'='confirm:'||c.quote_id::text,false)
        or coalesce(j.kind='text' and lower(trim(regexp_replace(trim(j.payload->>'text'),'[!.؟]+$',''))) in
          ('confirm '||left(c.quote_id::text,8),'ثبت '||left(c.quote_id::text,8)),false)
        or exists(select 1 from public.whatsapp_jobs oq where oq.conversation_id=c.id and oq.direction='out'
          and oq.dedupe_key='quote:'||c.quote_id::text and oq.provider_id=j.payload->>'context'
          and j.kind='text' and regexp_replace(lower(trim(j.payload->>'text')),'[!.؟]+$','')
            in ('إي ثبت','اي ثبت','ثبت','ثبت الطلب','yes confirm','confirm','confirm my order'))
      ) then return 'confirmation_expired'; end if;
      select order_id into oid from public.whatsapp_orders where quote_id=c.quote_id and conversation_id=c.id;
      if oid is not null then return 'confirmation_expired'; end if;
      priced := public.whatsapp_price(r.id,c.draft);
      if priced is null or priced is distinct from c.quote then return 'quote_changed'; end if;
      select * into created from ordova_private.insert_pending_order(
        r.id,case when p_locale='en' then 'WhatsApp customer' else 'زبون واتساب' end,
        'WhatsApp · Pickup',null,priced,'{"source":"whatsapp","fulfillment":"pickup"}',gen_random_uuid()::text);
      insert into public.whatsapp_orders values(created.id,r.id,c.id,c.quote_id,now());
      insert into public.whatsapp_jobs(restaurant_id,conversation_id,direction,kind,dedupe_key,payload)
      values(r.id,c.id,'out','order_status','submitted:'||created.id,
        jsonb_build_object('status',created.status,'order_number',created.order_number,'order_id',created.id));
      p_draft := '[]';
      result := 'submitted';
    else
      priced := public.whatsapp_price(r.id,p_draft);
      if priced is null or priced is distinct from p_quote then return 'quote_changed'; end if;
    end if;
  end if;
  if p_action <> 'skip' then
    update public.whatsapp_conversations set processed_at=j.occurred_at,locale=p_locale,
      draft=coalesce(p_draft,draft),
      quote=case when p_action='quote' then p_quote when p_action='reply' then quote end,
      quote_id=case when p_action='quote' then p_quote_id when p_action='reply' then quote_id end,
      quote_expires_at=case when p_action='quote' then now()+interval '20 minutes' when p_action='reply' then quote_expires_at end,
      handoff=handoff or (p_action='handoff' and s.handoff_enabled)
    where id=c.id;
    if p_reply is not null then
      insert into public.whatsapp_jobs(restaurant_id,conversation_id,direction,kind,dedupe_key,payload)
      values(j.restaurant_id,c.id,'out','reply',
        case when p_action='quote' then 'quote:'||p_quote_id else 'reply:'||j.id end,p_reply);
    end if;
  end if;
  update public.whatsapp_jobs set state=case when p_action='skip' then 'skipped' else 'done' end,lease=null,error_code=null
  where id=j.id;
  return result;
end $$;

-- Runs inside the existing order transaction. No external call or LLM work.
create function ordova_private.whatsapp_queue_order_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare link public.whatsapp_orders;
begin
  if old.status is distinct from new.status then
    select * into link from public.whatsapp_orders where order_id=new.id and restaurant_id=new.restaurant_id;
    if link.conversation_id is not null then
      insert into public.whatsapp_jobs(restaurant_id,conversation_id,direction,kind,dedupe_key,payload)
      values(new.restaurant_id,link.conversation_id,'out','order_status','status:'||gen_random_uuid(),
        jsonb_build_object('status',new.status,'order_number',new.order_number,'order_id',new.id));
    end if;
  end if;
  return new;
end $$;
create trigger whatsapp_order_status after update of status on public.orders
for each row execute function ordova_private.whatsapp_queue_order_status();

create function public.whatsapp_usage_summary(p_restaurant uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('attempts',count(*),'measured',count(input_tokens),
    'input_tokens',coalesce(sum(input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0),
    'estimated_usd',sum(estimated_usd),'estimated_attempts',count(estimated_usd))
  from public.whatsapp_usage where restaurant_id=p_restaurant
    and created_at>=date_trunc('month',now(),'UTC')
$$;

-- Schedule from Supabase Cron after populating the two Vault secrets.
-- Only contact the application when the durable queue has work to process.
create function public.whatsapp_dispatch_due() returns bigint
language plpgsql set search_path = '' as $$
declare worker_url text; worker_secret text;
begin
  if not exists(select 1 from public.whatsapp_jobs where direction in ('in','out')
    and state in ('queued','processing','sending') and run_at<=now()) then return null; end if;
  select decrypted_secret into strict worker_url from vault.decrypted_secrets where name='ordova_whatsapp_worker_url';
  select decrypted_secret into strict worker_secret from vault.decrypted_secrets where name='ordova_whatsapp_worker_secret';
  return net.http_post(url := worker_url,
    headers := jsonb_build_object('Authorization','Bearer '||worker_secret,'Content-Type','application/json'),
    body := '{}'::jsonb,timeout_milliseconds := 55000);
end $$;

-- Keep recent message content and customer identifiers bounded. Orders remain ORDOVA records.
create function public.whatsapp_prune() returns void
language plpgsql set search_path = '' as $$
begin
  delete from public.whatsapp_signup where expires_at < now()-interval '1 day';
  update public.whatsapp_signup set token_ciphertext=null where expires_at<now() and token_ciphertext is not null;
  delete from public.whatsapp_usage where created_at < now()-interval '90 days';
  update public.whatsapp_jobs set payload='{}' where created_at<now()-interval '30 days' and payload<>'{}'
    and state not in ('queued','processing','sending');
  delete from public.whatsapp_jobs where created_at < now()-interval '90 days';
  delete from public.whatsapp_conversations c where last_inbound_at<now()-interval '90 days'
    and not exists(select 1 from public.whatsapp_orders w join public.orders o on o.id=w.order_id
      where w.conversation_id=c.id and o.status in ('pending','preparing','ready'));
  update public.whatsapp_accounts set status='reconnect_required',last_error='onboarding_interrupted',onboarding_id=null
    where status='connecting' and operation_at<now()-interval '3 minutes';
  update public.whatsapp_accounts set status='reconnect_required',last_error='disconnect_interrupted'
    where status='disconnecting' and operation_at<now()-interval '3 minutes';
  update public.whatsapp_accounts set status='reconnect_required',last_error='token_expired',token_ciphertext=null
    where status='connected' and (token_expires_at<=now() or data_access_expires_at<=now());
end $$;

-- A tenant row lock enforces the signup throttle under concurrent requests.
create function public.whatsapp_begin_signup(p_restaurant uuid,p_user uuid)
returns uuid language plpgsql set search_path = '' as $$
declare new_id uuid;
begin
  perform 1 from public.restaurants where id=p_restaurant for update;
  if not found or not exists (select 1 from public.restaurant_members where
    restaurant_id=p_restaurant and user_id=p_user and role='owner' and active) then return null; end if;
  if (select count(*) from public.whatsapp_signup where restaurant_id=p_restaurant and
    expires_at>now()-interval '5 minutes') >= 8 then return null; end if;
  insert into public.whatsapp_signup(restaurant_id,user_id) values(p_restaurant,p_user) returning id into new_id;
  return new_id;
end $$;

create function public.whatsapp_reserve_account(
  p_restaurant uuid,p_signup uuid,p_phone text,p_waba text,p_display text,p_coexistence boolean
) returns text language plpgsql set search_path = '' as $$
begin
  perform 1 from public.restaurants where id=p_restaurant for update;
  if not found or not public.restaurant_subscription_active(p_restaurant) or not exists (
    select 1 from public.whatsapp_signup s join public.restaurant_members m
      on m.restaurant_id=s.restaurant_id and m.user_id=s.user_id and m.role='owner' and m.active
    where s.id=p_signup and s.restaurant_id=p_restaurant and s.expires_at>now()
      and s.token_ciphertext is not null
  ) then return 'signup_expired'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ordova:whatsapp:waba:'||p_waba,0));
  if exists(select 1 from public.whatsapp_accounts where (restaurant_id=p_restaurant or waba_id=p_waba)
    and status in ('connecting','disconnecting') and operation_at>now()-interval '3 minutes') then
    return 'account_operation_unavailable';
  end if;
  if exists(select 1 from public.whatsapp_accounts where restaurant_id=p_restaurant
    and phone_id<>p_phone and status<>'disconnected') then return 'disconnect_current_number'; end if;
  insert into public.whatsapp_accounts(phone_id,restaurant_id,waba_id,display_phone,status,coexistence,onboarding_id)
  values(p_phone,p_restaurant,p_waba,p_display,'connecting',p_coexistence,p_signup)
  on conflict(restaurant_id,phone_id) do update set waba_id=excluded.waba_id,display_phone=excluded.display_phone,status='connecting',
    coexistence=excluded.coexistence,onboarding_id=excluded.onboarding_id,operation_at=now(),last_error=null
  where whatsapp_accounts.waba_id=p_waba or whatsapp_accounts.status='disconnected';
  return case when found then 'reserved' else 'account_in_use' end;
exception when unique_violation then return 'account_in_use';
end $$;

-- Subscriptions belong to a Messaging account, while ORDOVA connections belong
-- to a phone. Coordinate account operations so disconnecting one phone cannot
-- unsubscribe another branch or race a new subscription to the same account.
create function public.whatsapp_begin_disconnect(p_restaurant uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare a public.whatsapp_accounts; unsubscribe boolean;
begin
  perform 1 from public.restaurants where id=p_restaurant for update;
  select * into a from public.whatsapp_accounts where restaurant_id=p_restaurant
    and status in ('connected','reconnect_required');
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('ordova:whatsapp:waba:'||a.waba_id,0));
  if exists(select 1 from public.whatsapp_accounts where waba_id=a.waba_id
    and status in ('connecting','disconnecting') and operation_at>now()-interval '3 minutes') then
    return null;
  end if;
  update public.whatsapp_accounts set status='disconnecting',operation_at=now()
    where restaurant_id=a.restaurant_id and phone_id=a.phone_id returning * into a;
  unsubscribe := not exists(select 1 from public.whatsapp_accounts where waba_id=a.waba_id
    and restaurant_id<>p_restaurant and status<>'disconnected');
  return jsonb_build_object('account',to_jsonb(a),'unsubscribe',unsubscribe);
end $$;

create function public.whatsapp_conversation_usage(p_restaurant uuid,p_conversation uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('input_tokens',coalesce(sum(input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0),
    'estimated_usd',sum(estimated_usd),'measured',count(input_tokens),'estimated_attempts',count(estimated_usd),'attempts',count(*))
  from public.whatsapp_usage where restaurant_id=p_restaurant and conversation_id=p_conversation
$$;

create function public.whatsapp_handoff_action(p_restaurant uuid,p_conversation uuid,p_action text,p_text text,p_message uuid)
returns text language plpgsql set search_path = '' as $$
declare c public.whatsapp_conversations;
begin
  select * into c from public.whatsapp_conversations where id=p_conversation and restaurant_id=p_restaurant for update;
  if not found then return 'conversation_not_found'; end if;
  if p_action in ('take','resume') then
    update public.whatsapp_conversations set handoff=p_action='take',quote_id=null,quote=null,quote_expires_at=null
      where id=c.id;
  elsif p_action='reply' then
    if not c.handoff then return 'take_over_required'; end if;
    if c.last_inbound_at <= now()-interval '24 hours' then return 'service_window_closed'; end if;
    if not exists(select 1 from public.whatsapp_accounts where restaurant_id=c.restaurant_id and phone_id=c.phone_id and status='connected' and subscribed)
      then return 'account_disconnected'; end if;
    if (select count(*) from public.whatsapp_jobs where conversation_id=c.id and direction='out'
      and kind='manual' and created_at>now()-interval '1 minute')>=12 then return 'reply_rate_limited'; end if;
    insert into public.whatsapp_jobs(restaurant_id,conversation_id,direction,kind,dedupe_key,payload)
    values(p_restaurant,c.id,'out','manual','manual:'||p_message,jsonb_build_object('text',p_text))
    on conflict do nothing;
  else return 'invalid_conversation_action'; end if;
  return 'ok';
end $$;
do $$
declare proc record;
begin
  for proc in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and left(p.proname,9)='whatsapp_' loop
    execute format('revoke execute on function %s from public,anon,authenticated',proc.signature);
    execute format('grant execute on function %s to service_role',proc.signature);
  end loop;
end $$;
revoke execute on function ordova_private.whatsapp_queue_order_status() from public,anon,authenticated;
-- Only the database scheduler can use the Vault-backed worker credentials.
revoke execute on function public.whatsapp_dispatch_due() from service_role;

commit;
