begin;
alter table public.whatsapp_settings add column delivery_enabled boolean not null default false,
 add column delivery_zones jsonb not null default '[]' check(jsonb_typeof(delivery_zones)='array' and jsonb_array_length(delivery_zones)<=100);
alter table public.whatsapp_conversations add column whatsapp_sender_phone text check(whatsapp_sender_phone ~ '^\+[1-9][0-9]{6,14}$'),
 add column delivery_state jsonb not null default '{}' check(jsonb_typeof(delivery_state)='object');

create function ordova_private.delivery_normalize(p_text text) returns text language sql immutable set search_path='' as $$
 select trim(regexp_replace(translate(lower(coalesce(p_text,'')),'أإآىةگڨ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','ااايهكك01234567890123456789'),'[^[:alnum:]ء-ي]+',' ','g'))
$$;
create function ordova_private.delivery_phone(p_text text) returns text language plpgsql immutable set search_path='' as $$
declare n text;
begin
 if p_text is null or length(p_text)>80 then return null; end if;
 n:=regexp_replace(translate(p_text,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[ ()\s-]','','g');
 if n ~ '^00' then n:='+'||substring(n from 3); end if;
 if n ~ '^07[0-9]{9}$' then n:='+964'||substring(n from 2);
 elsif n ~ '^[1-9][0-9]{6,14}$' then n:='+'||n; end if;
 if n ~ '^\+[1-9][0-9]{6,14}$' and n !~ '^\+9640' then return n; end if;
 return null;
end $$;

-- Ingress alone can set the verified sender. Alternative delivery numbers never
-- pass through this function or overwrite the authenticated WhatsApp identity.
alter function public.whatsapp_ingest(jsonb) rename to whatsapp_ingest_metered;
create function public.whatsapp_ingest(p_events jsonb) returns integer language plpgsql set search_path='' as $$
declare inserted integer; e jsonb; incoming text;
begin
 inserted:=public.whatsapp_ingest_metered(p_events);
 for e in select value from jsonb_array_elements(p_events) where value->>'kind'='identity' loop
  update public.whatsapp_conversations c set whatsapp_sender_phone=null,quote_id=null,quote=null,quote_expires_at=null,
    delivery_state=case when c.delivery_state->>'deliveryPhoneSource'='whatsapp'
      then (c.delivery_state-'deliveryContactPhone'-'deliveryPhoneSource')||'{"awaitingConfirmation":false,"awaitingField":"phone_choice"}'::jsonb
      else c.delivery_state||'{"awaitingConfirmation":false}'::jsonb end
   from public.whatsapp_accounts a where a.restaurant_id=c.restaurant_id and a.phone_id=c.phone_id and a.status='connected'
     and c.phone_id=e->>'phone' and a.waba_id=e->>'waba' and c.customer_id=e->>'customer'
     and to_timestamp((e->>'time')::bigint)>=c.last_inbound_at;
 end loop;
 for e in select value from jsonb_array_elements(p_events) where value->>'kind' in ('text','button','location','unsupported') loop
  incoming:=case when e->>'customer_phone' ~ '^[1-9][0-9]{6,14}$' then '+'||(e->>'customer_phone') end;
  if incoming is not null then
   update public.whatsapp_conversations c set whatsapp_sender_phone=incoming,
    delivery_state=case when c.whatsapp_sender_phone is not null and c.whatsapp_sender_phone<>incoming and c.delivery_state->>'deliveryPhoneSource'='whatsapp'
      then (c.delivery_state-'deliveryContactPhone'-'deliveryPhoneSource')||'{"awaitingField":"phone_choice","awaitingConfirmation":false}'::jsonb else c.delivery_state end,
    quote_id=case when c.whatsapp_sender_phone is not null and c.whatsapp_sender_phone<>incoming then null else c.quote_id end,
    quote=case when c.whatsapp_sender_phone is not null and c.whatsapp_sender_phone<>incoming then null else c.quote end
   from public.whatsapp_accounts a where a.restaurant_id=c.restaurant_id and a.phone_id=c.phone_id and a.status='connected' and a.subscribed
    and c.phone_id=e->>'phone' and a.waba_id=e->>'waba' and c.customer_id=e->>'customer'
    and to_timestamp((e->>'time')::bigint)>=c.last_inbound_at
    and exists(select 1 from public.whatsapp_jobs j where j.conversation_id=c.id and j.direction='in' and j.dedupe_key=e->>'provider_id');
  end if;
 end loop;
 return inserted;
end $$;
create or replace function public.whatsapp_ingest_gupshup(p_restaurant uuid,p_phone text,p_secret text,p_events jsonb)
returns integer language plpgsql set search_path='' as $$
begin
 perform 1 from public.whatsapp_accounts where restaurant_id=p_restaurant and phone_id=p_phone and provider='gupshup'
  and status='connected' and webhook_secret_ciphertext=p_secret for update;
 if not found then return -1; end if;
 if exists(select 1 from jsonb_array_elements(p_events) e where e->>'phone'<>p_phone or e->>'waba'<>p_phone
  or e->>'kind' not in ('text','button','location','unsupported','status')) then return -1; end if;
 update public.whatsapp_accounts set subscribed=true,last_webhook_at=now() where restaurant_id=p_restaurant and phone_id=p_phone;
 return public.whatsapp_ingest(p_events);
end $$;

create function public.whatsapp_delivery_price(p_restaurant uuid,p_conversation uuid,p_items jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare c public.whatsapp_conversations; s public.whatsapp_settings; priced jsonb; addr text; zone jsonb; candidates jsonb; n integer; remainder text;
begin
 select * into c from public.whatsapp_conversations where restaurant_id=p_restaurant and id=p_conversation;
 if not found then return jsonb_build_object('next','items'); end if;
 select * into s from public.whatsapp_settings where restaurant_id=p_restaurant;
 if s.delivery_enabled is distinct from true or s.ordering_enabled is distinct from true or coalesce(jsonb_array_length(s.delivery_zones),0)=0 then return jsonb_build_object('next','coverage'); end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then return jsonb_build_object('next','items'); end if;
 priced:=public.whatsapp_price(p_restaurant,p_items);
 if priced is null then return jsonb_build_object('next','items_changed'); end if;
 addr:=ordova_private.delivery_normalize(c.delivery_state->'address'->>'details');
 if length(addr)<3 then return jsonb_build_object('next','address'); end if;
 select jsonb_agg(z) into candidates from jsonb_array_elements(s.delivery_zones) z
  where length(z->>'area')>=2 and strpos(' '||addr||' ',' '||ordova_private.delivery_normalize(z->>'area')||' ')>0;
 n:=coalesce(jsonb_array_length(candidates),0);
 if n>1 then
  select jsonb_agg(z) into candidates from jsonb_array_elements(candidates) z
    where strpos(' '||addr||' ',' '||ordova_private.delivery_normalize(z->>'city')||' ')>0;
  n:=coalesce(jsonb_array_length(candidates),0);
 end if;
 if n<>1 then return jsonb_build_object('next','coverage'); end if;
 zone:=candidates->0;
 if coalesce(zone->>'fee','') !~ '^[0-9]+(\.[0-9]{1,2})?$' or (zone->>'fee')::numeric>1000000 then return jsonb_build_object('next','coverage'); end if;
 remainder:=trim(replace(replace(addr,ordova_private.delivery_normalize(zone->>'city'),''),ordova_private.delivery_normalize(zone->>'area'),''));
 if length(remainder)<6 then return jsonb_build_object('next','address_details'); end if;
 if ordova_private.delivery_phone(c.delivery_state->>'deliveryContactPhone') is null then return jsonb_build_object('next','phone_choice'); end if;
 if c.delivery_state->>'deliveryPhoneSource'='whatsapp' and (c.whatsapp_sender_phone is null or c.delivery_state->>'deliveryContactPhone'<>c.whatsapp_sender_phone) then return jsonb_build_object('next','phone_choice'); end if;
 if coalesce(c.delivery_state->>'deliveryPhoneSource','') not in ('whatsapp','alternative') then return jsonb_build_object('next','phone_choice'); end if;
 if (priced->>'total')::numeric+(zone->>'fee')::numeric>999999999999.99 then return jsonb_build_object('next','items_changed'); end if;
 return jsonb_build_object('next','confirmation','price',priced||jsonb_build_object(
  'subtotal',priced->'total','delivery_fee',(zone->>'fee')::numeric,'total',(priced->>'total')::numeric+(zone->>'fee')::numeric,
  'fulfillment','delivery','zone_id',zone->>'id','address',coalesce(c.delivery_state->'address','{}')||jsonb_build_object('city',zone->>'city','area',zone->>'area'),
  'contact_phone',c.delivery_state->>'deliveryContactPhone','phone_source',c.delivery_state->>'deliveryPhoneSource'));
end $$;

create function public.whatsapp_delivery_update(p_job uuid,p_lease uuid,p_items jsonb,p_address text,p_phone_mode text,p_phone_text text)
returns jsonb language plpgsql set search_path='' as $$
declare j public.whatsapp_jobs; c public.whatsapp_conversations; s public.whatsapp_settings; state jsonb; status jsonb; raw text; normalized text; contact text; location jsonb;
begin
 select * into j from public.whatsapp_jobs where id=p_job and lease=p_lease and direction='in' and whatsapp_jobs.state='processing' and run_at>now() for update;
 if not found then return jsonb_build_object('next','lease_lost'); end if;
 select * into c from public.whatsapp_conversations where id=j.conversation_id and restaurant_id=j.restaurant_id for update;
 select * into s from public.whatsapp_settings where restaurant_id=j.restaurant_id for share;
 if s.enabled is distinct from true or s.delivery_enabled is distinct from true or not public.restaurant_subscription_active(j.restaurant_id) or c.handoff then return jsonb_build_object('next','disabled'); end if;
 if p_phone_mode is not null and p_phone_mode not in ('whatsapp','alternative','provided') then return jsonb_build_object('next','invalid_phone_choice'); end if;
 state:=case when c.delivery_state ? 'confirmedOrderId' and p_items is not null then '{}'::jsonb else c.delivery_state end;
 state:=(state-'confirmedOrderId')||'{"fulfillment":"delivery","awaitingConfirmation":false}'::jsonb;
 raw:=coalesce(j.payload->>'text',''); normalized:=ordova_private.delivery_normalize(raw);
 if p_items is not null then
  if public.whatsapp_price(j.restaurant_id,p_items) is null then return jsonb_build_object('next','items_changed'); end if;
  c.draft:=p_items;
 end if;
 if j.kind='location' and jsonb_typeof(j.payload->'location')='object' then
  location:=j.payload->'location';
  if jsonb_typeof(location->'latitude')='number' and jsonb_typeof(location->'longitude')='number'
   and (location->>'latitude')::numeric between -90 and 90 and (location->>'longitude')::numeric between -180 and 180 then
   state:=jsonb_set(state,'{address}',jsonb_strip_nulls(jsonb_build_object('latitude',location->'latitude','longitude',location->'longitude','details',location->>'address')));
  end if;
 end if;
 if p_address is not null then
  if length(p_address) not between 3 and 400 or p_address ~ '[\x00-\x1f]' or
   (strpos(raw,p_address)=0 and p_address is distinct from j.payload->'location'->>'address' and
    not(coalesce(c.delivery_state->>'awaitingField'='address_details',false) and p_address=coalesce(c.delivery_state->'address'->>'details','')||'، '||raw)) then return jsonb_build_object('next','invalid_address'); end if;
  state:=jsonb_set(state,'{address}',case when state->'address'->>'details' is null then coalesce(state->'address','{}')||jsonb_build_object('details',p_address) else jsonb_build_object('details',p_address) end);
 end if;
 if p_phone_mode='whatsapp' then
  if normalized ~ '(^| )(لا|مو|ما اريد|not|do not) .{0,25}(نفس|whatsapp|same)' then return jsonb_build_object('next','invalid_phone_choice'); end if;
  if normalized !~ '(نفس (رقم|الرقم)|على رقمي|same (number|phone)|whatsapp number)' then return jsonb_build_object('next','invalid_phone_choice'); end if;
  state:=(state-'deliveryContactPhone'-'deliveryPhoneSource')||'{"phonePreference":"whatsapp"}'::jsonb;
  if c.whatsapp_sender_phone is not null then state:=state||jsonb_build_object('deliveryContactPhone',c.whatsapp_sender_phone,'deliveryPhoneSource','whatsapp');
  else state:=state||'{"awaitingField":"alternative_phone","phoneError":true}'::jsonb; end if;
 elsif p_phone_mode='alternative' then
  if normalized !~ '(رقم (ثاني|اخر|غير)|another (number|phone)|different (number|phone))' then return jsonb_build_object('next','invalid_phone_choice'); end if;
  state:=(state-'deliveryContactPhone'-'deliveryPhoneSource')||'{"awaitingField":"alternative_phone","phonePreference":"alternative"}'::jsonb;
 elsif p_phone_mode='provided' then
  if normalized ~ '(^| )(لا|مو|ما اريد|not|do not) .{0,30}(رقم|phone|number|[0-9]{4})' then return jsonb_build_object('next','invalid_phone_choice'); end if;
  if p_phone_text is null or strpos(raw,p_phone_text)=0 or
   (coalesce(c.delivery_state->>'awaitingField','') not in ('alternative_phone','phone_choice') and normalized !~ '(رقم|phone|number|contact|اتصل)') then return jsonb_build_object('next','invalid_phone_choice'); end if;
  contact:=ordova_private.delivery_phone(p_phone_text);
  state:=state-'deliveryContactPhone'-'deliveryPhoneSource';
  if contact is null then state:=state||'{"awaitingField":"alternative_phone","phoneError":true}'::jsonb;
  else state:=(state-'phoneError')||jsonb_build_object('deliveryContactPhone',contact,'deliveryPhoneSource','alternative'); end if;
 end if;
 update public.whatsapp_conversations set draft=c.draft,delivery_state=state,quote_id=null,quote=null,quote_expires_at=null where id=c.id;
 status:=public.whatsapp_delivery_price(j.restaurant_id,c.id,c.draft);
 if status->>'next'='phone_choice' and (state->>'awaitingField'='alternative_phone' or state->>'phonePreference'='alternative') then status:=jsonb_set(status,'{next}','"alternative_phone"'); end if;
 state:=state||jsonb_build_object('awaitingField',status->>'next');
 update public.whatsapp_conversations set delivery_state=state where id=c.id;
 return status||jsonb_build_object('state',state,'sender_available',c.whatsapp_sender_phone is not null);
end $$;

-- Extend the existing completion boundary; the pickup implementation and the
-- shared pending-order writer remain the source of truth for existing orders.
alter function public.whatsapp_complete(uuid,uuid,text,text,jsonb,uuid,jsonb,jsonb) rename to whatsapp_complete_pickup;
create function public.whatsapp_complete(p_job uuid,p_lease uuid,p_locale text,p_action text,p_draft jsonb,p_quote_id uuid,p_quote jsonb,p_reply jsonb)
returns text language plpgsql set search_path='' as $$
declare j public.whatsapp_jobs; c public.whatsapp_conversations; s public.whatsapp_settings; a public.whatsapp_accounts;
 r public.restaurants; checked jsonb; priced jsonb; created public.orders; response text; normalized text;
begin
 if p_action not in ('delivery_quote','delivery_confirm','delivery_cancel') then
  response:=public.whatsapp_complete_pickup(p_job,p_lease,p_locale,p_action,p_draft,p_quote_id,p_quote,p_reply);
  if response<>'lease_lost' then
   update public.whatsapp_conversations convo set delivery_state=case when p_action in ('quote','reset_quote') then '{}'::jsonb else convo.delivery_state||'{"awaitingConfirmation":false}'::jsonb end,
    quote_id=case when p_action='quote' then convo.quote_id end,quote=case when p_action='quote' then convo.quote end,
    quote_expires_at=case when p_action='quote' then convo.quote_expires_at end
   from public.whatsapp_jobs incoming where incoming.id=p_job and convo.id=incoming.conversation_id and convo.delivery_state->>'fulfillment'='delivery'
    and p_action in ('reply','quote','reset_quote','handoff');
  end if;
  if response='done' and p_action='quote' then
   update public.whatsapp_conversations convo set delivery_state='{"fulfillment":"pickup"}' from public.whatsapp_jobs incoming where incoming.id=p_job and convo.id=incoming.conversation_id;
  elsif response='submitted' and p_action='confirm' then
   update public.whatsapp_conversations convo set delivery_state='{}' from public.whatsapp_jobs incoming where incoming.id=p_job and convo.id=incoming.conversation_id;
  end if;
  return response;
 end if;
 select * into j from public.whatsapp_jobs where id=p_job and lease=p_lease and direction='in' and state='processing' and run_at>now() for update;
 if not found then return 'lease_lost'; end if;
 select * into c from public.whatsapp_conversations where id=j.conversation_id and restaurant_id=j.restaurant_id for update;
 select * into r from public.restaurants where id=j.restaurant_id for update;
 select * into s from public.whatsapp_settings where restaurant_id=j.restaurant_id for share;
 select * into a from public.whatsapp_accounts where restaurant_id=j.restaurant_id and phone_id=c.phone_id for share;
 if a.status is distinct from 'connected' or not a.subscribed or a.token_expires_at<=now() or a.data_access_expires_at<=now()
  or not s.enabled or not public.subscription_active(r) or c.handoff or j.occurred_at<now()-interval '24 hours'
  or j.occurred_at<date_trunc('second',a.operation_at) or j.occurred_at<c.processed_at then return 'ordering_closed'; end if;
 if p_action='delivery_cancel' then
  update public.whatsapp_conversations set draft='[]',delivery_state='{}',quote=null,quote_id=null,quote_expires_at=null where id=c.id;
 else
  if not s.ordering_enabled or not s.delivery_enabled or not public.whatsapp_open(r.id) then return 'ordering_closed'; end if;
  checked:=public.whatsapp_delivery_price(r.id,c.id,c.draft); priced:=checked->'price';
  if p_action='delivery_quote' then
   if p_quote_id is null or priced is null or priced is distinct from p_quote then return 'quote_changed'; end if;
   update public.whatsapp_conversations set quote_id=p_quote_id,quote=priced,quote_expires_at=now()+interval '20 minutes',
    delivery_state=delivery_state||jsonb_build_object('awaitingConfirmation',true,'awaitingField','confirmation','quoteIssuedAt',now(),'address',priced->'address') where id=c.id;
  else
   normalized:=ordova_private.delivery_normalize(j.payload->>'text');
   if c.quote_id is null or c.quote_id is distinct from p_quote_id or c.quote_expires_at<=now() or c.delivery_state->>'awaitingConfirmation' is distinct from 'true'
    or c.delivery_state->>'quoteIssuedAt' is null
    or j.occurred_at<date_trunc('second',(c.delivery_state->>'quoteIssuedAt')::timestamptz)
    or not exists(select 1 from public.whatsapp_jobs q where q.conversation_id=c.id and q.direction='out' and q.dedupe_key='quote:'||c.quote_id
      and q.created_at>=a.operation_at and q.created_at<=j.created_at and (q.state in ('accepted','sent','delivered','read')
        or (q.state in ('sending','uncertain') and j.kind='button' and j.payload->>'button'='confirm:'||c.quote_id)))
    or not (coalesce(j.kind='button' and j.payload->>'button'='confirm:'||c.quote_id,false)
      or coalesce(j.kind='text' and normalized in ('اي','اي ثبت','ثبت','ثبت الطلب','نعم','yes','yes confirm','confirm','confirm my order',
        'confirm '||left(c.quote_id::text,8),'ثبت '||left(c.quote_id::text,8)),false)) then return 'confirmation_expired'; end if;
   if exists(select 1 from public.whatsapp_orders where quote_id=c.quote_id) then return 'confirmation_expired'; end if;
   if priced is null or priced is distinct from c.quote then return 'quote_changed'; end if;
   select * into created from ordova_private.insert_pending_order(r.id,case when p_locale='en' then 'WhatsApp customer' else 'زبون واتساب' end,
    'WhatsApp · Delivery',null,priced,jsonb_build_object('source','whatsapp','fulfillment','delivery','delivery',
      jsonb_build_object('address',priced->'address','contactPhone',priced->>'contact_phone','phoneSource',priced->>'phone_source','fee',priced->'delivery_fee','subtotal',priced->'subtotal')),gen_random_uuid()::text);
   insert into public.whatsapp_orders values(created.id,r.id,c.id,c.quote_id,now());
   insert into public.whatsapp_jobs(restaurant_id,conversation_id,direction,kind,dedupe_key,payload) values(r.id,c.id,'out','order_status','submitted:'||created.id,
    jsonb_build_object('status',created.status,'order_number',created.order_number,'order_id',created.id,'fulfillment','delivery'));
   update public.whatsapp_conversations set draft='[]',quote=null,quote_id=null,quote_expires_at=null,
    delivery_state=jsonb_build_object('confirmedOrderId',created.id,'awaitingConfirmation',false) where id=c.id;
  end if;
 end if;
 update public.whatsapp_conversations set locale=p_locale,processed_at=j.occurred_at where id=c.id;
 if p_reply is not null and p_action<>'delivery_confirm' then
  insert into public.whatsapp_jobs(restaurant_id,conversation_id,direction,kind,dedupe_key,payload) values(j.restaurant_id,c.id,'out','reply',
   case when p_action='delivery_quote' then 'quote:'||p_quote_id else 'reply:'||j.id end,p_reply) on conflict do nothing;
 end if;
 update public.whatsapp_jobs set state='done',lease=null,error_code=null where id=j.id;
 return case when p_action='delivery_confirm' then 'submitted' else 'done' end;
end $$;

create or replace function ordova_private.whatsapp_queue_order_status() returns trigger language plpgsql security definer set search_path='' as $$
declare link public.whatsapp_orders;
begin
 if old.status is distinct from new.status then
  select * into link from public.whatsapp_orders where order_id=new.id and restaurant_id=new.restaurant_id;
  if link.conversation_id is not null then
   insert into public.whatsapp_jobs(restaurant_id,conversation_id,direction,kind,dedupe_key,payload) values(new.restaurant_id,link.conversation_id,'out','order_status','status:'||gen_random_uuid(),
    jsonb_build_object('status',new.status,'order_number',new.order_number,'order_id',new.id,'fulfillment',new.device_metadata->>'fulfillment'));
  end if;
 end if;
 return new;
end $$;
revoke execute on function ordova_private.delivery_normalize(text),ordova_private.delivery_phone(text),public.whatsapp_ingest(jsonb),public.whatsapp_delivery_price(uuid,uuid,jsonb),
 public.whatsapp_delivery_update(uuid,uuid,jsonb,text,text,text),public.whatsapp_complete(uuid,uuid,text,text,jsonb,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function ordova_private.delivery_normalize(text),ordova_private.delivery_phone(text),public.whatsapp_ingest(jsonb),public.whatsapp_delivery_price(uuid,uuid,jsonb),
 public.whatsapp_delivery_update(uuid,uuid,jsonb,text,text,text),public.whatsapp_complete(uuid,uuid,text,text,jsonb,uuid,jsonb,jsonb) to service_role;

alter function public.whatsapp_prune() rename to whatsapp_prune_before_delivery;
create function public.whatsapp_prune() returns void language plpgsql set search_path='' as $$
begin
 perform public.whatsapp_prune_before_delivery();
 update public.whatsapp_conversations set delivery_state='{}',quote_id=null,quote=null,quote_expires_at=null
  where last_inbound_at<now()-interval '30 days' and delivery_state<>'{}'::jsonb;
end $$;
revoke execute on function public.whatsapp_prune() from public,anon,authenticated;
grant execute on function public.whatsapp_prune() to service_role;
-- A new verified summary permits the same brief confirmation phrase again.
create or replace function public.whatsapp_prepare_inbound(p_job uuid,p_lease uuid) returns jsonb language plpgsql set search_path='' as $$
declare j public.whatsapp_jobs; p jsonb; reason text; gate text; ids uuid[]; combined text; latest timestamptz;
begin
 select * into j from public.whatsapp_jobs where id=p_job and lease=p_lease and direction='in' and state='processing' and run_at>now() for update;
 if not found then return jsonb_build_object('gate','skip'); end if;
 if j.payload ? 'admission' then return jsonb_build_object('gate',j.payload->>'admission','payload',j.payload,'occurred_at',j.occurred_at); end if;
 select ai_policy into p from public.whatsapp_settings where restaurant_id=j.restaurant_id for update;
 if not found then return jsonb_build_object('gate','skip'); end if;
 if length(coalesce(j.payload->>'text',''))>coalesce((p->>'max_input_chars')::int,2000) then reason:='input_too_long';
 elsif (select count(*) from public.whatsapp_jobs where conversation_id=j.conversation_id and direction='in' and created_at>=date_trunc('day',now(),'UTC'))>coalesce((p->>'customer_daily_requests')::int,100) then reason:='customer_daily_limit';
 elsif (select count(*) from public.whatsapp_jobs where conversation_id=j.conversation_id and direction='in' and created_at>=now()-interval '1 minute')>coalesce((p->>'customer_rpm')::int,12) then reason:='customer_rate_limit';
 elsif (select count(*) from public.whatsapp_jobs where restaurant_id=j.restaurant_id and direction='in' and created_at>=now()-interval '1 minute')>coalesce((p->>'restaurant_rpm')::int,120) then reason:='restaurant_rate_limit';
 elsif (select count(*) from public.whatsapp_jobs where conversation_id=j.conversation_id and direction='out' and kind='reply' and created_at>=now()-interval '24 hours')>=coalesce((p->>'conversation_responses')::int,80) then reason:='conversation_limit';
 elsif j.kind='text' and not exists(select 1 from public.whatsapp_conversations active
  where active.id=j.conversation_id and active.delivery_state->>'awaitingConfirmation'='true'
   and ordova_private.delivery_normalize(j.payload->>'text') in ('اي','اي ثبت','ثبت','ثبت الطلب','نعم','yes','yes confirm','confirm','confirm my order')
   and exists(select 1 from public.whatsapp_jobs q where q.conversation_id=active.id and q.dedupe_key='quote:'||active.quote_id and q.created_at<=j.created_at))
  and exists(select 1 from public.whatsapp_jobs old where old.conversation_id=j.conversation_id and old.direction='in' and old.seq<j.seq and old.created_at>=j.created_at-interval '1 minute'
  and lower(regexp_replace(trim(old.payload->>'text'),'\s+',' ','g'))=lower(regexp_replace(trim(j.payload->>'text'),'\s+',' ','g'))) then reason:='repeated_message'; end if;
 if reason is not null then
  gate:='skip';
  if reason not in ('repeated_message','customer_rate_limit','restaurant_rate_limit','conversation_limit') and
   not exists(select 1 from public.whatsapp_jobs where conversation_id=j.conversation_id and id<>j.id and payload ? 'guard_reason' and created_at>=now()-interval '10 minutes') and
   (select count(*) from public.whatsapp_jobs where restaurant_id=j.restaurant_id and payload->>'admission'='notice' and created_at>=now()-interval '1 minute')<3 then gate:='notice'; end if;
 else
  gate:='process';
  if j.kind='text' and not(j.payload ? 'context') and coalesce(j.payload->>'text','') !~* 'ثبت|confirm' then
   select array_agg(q.id order by q.occurred_at,q.seq),string_agg(q.payload->>'text',E'\n' order by q.occurred_at,q.seq),max(q.occurred_at) into ids,combined,latest
   from (select * from public.whatsapp_jobs where conversation_id=j.conversation_id and direction='in' and kind='text' and state='queued' and attempts=0
    and created_at between j.created_at and j.created_at+interval '3 seconds' and not(payload ? 'context') and coalesce(payload->>'text','') !~* 'ثبت|confirm'
    order by occurred_at,seq limit 3 for update skip locked) q;
   if combined is not null and length((j.payload->>'text')||E'\n'||combined)<=coalesce((p->>'max_input_chars')::int,2000) then
    j.payload:=jsonb_set(j.payload,'{text}',to_jsonb((j.payload->>'text')||E'\n'||combined))||jsonb_build_object('batch_count',cardinality(ids)+1);
    j.occurred_at:=greatest(j.occurred_at,latest);
    update public.whatsapp_jobs set state='skipped',error_code='batched',payload=payload||'{"guard_reason":"batched"}'::jsonb where id=any(ids);
   end if;
  end if;
 end if;
 j.payload:=j.payload||jsonb_build_object('admission',gate);
 if reason is not null then j.payload:=j.payload||jsonb_build_object('guard_reason',reason); end if;
 update public.whatsapp_jobs set payload=j.payload,occurred_at=j.occurred_at where id=j.id;
 return jsonb_build_object('gate',gate,'payload',j.payload,'occurred_at',j.occurred_at);
end $$;

commit;
