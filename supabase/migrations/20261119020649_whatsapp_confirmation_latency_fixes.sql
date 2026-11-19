begin;
create or replace function public.whatsapp_delivery_update(p_job uuid,p_lease uuid,p_items jsonb,p_address text,p_phone_mode text,p_phone_text text)
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
   (coalesce(c.delivery_state->>'awaitingField','') not in ('alternative_phone','phone_choice') and normalized !~ '(رقم|phone|number|contact|اتصل)' and not exists(select 1 from regexp_split_to_table(raw,E'\\r?\\n') line where btrim(line)=p_phone_text and ordova_private.delivery_phone(line) is not null)) then return jsonb_build_object('next','invalid_phone_choice'); end if;
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


create or replace function public.whatsapp_complete(p_job uuid,p_lease uuid,p_locale text,p_action text,p_draft jsonb,p_quote_id uuid,p_quote jsonb,p_reply jsonb)
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
    and p_action in ('quote','reset_quote','handoff');
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
revoke execute on function public.whatsapp_delivery_update(uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.whatsapp_delivery_update(uuid,uuid,jsonb,text,text,text) to service_role;
revoke execute on function public.whatsapp_complete(uuid,uuid,text,text,jsonb,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.whatsapp_complete(uuid,uuid,text,text,jsonb,uuid,jsonb,jsonb) to service_role;
-- Retain a small burst window without waiting for the ten-second cron tick.
do $latency$
declare definition text;
begin
 definition:=pg_get_functiondef('public.whatsapp_ingest_core(jsonb)'::regprocedure);
 if strpos(definition, '2 seconds')=0 then raise exception 'Expected ingress batching interval missing'; end if;
 execute replace(definition, '2 seconds', '350 milliseconds');
end $latency$;
commit;
