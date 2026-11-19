begin;
alter table public.whatsapp_settings add column ai_policy jsonb not null default
 '{"customer_daily_requests":100,"customer_rpm":12,"restaurant_rpm":120,"monthly_requests":4500,"conversation_responses":80,"daily_budget_usd":1,"monthly_budget_usd":10,"request_max_usd":0.02,"max_input_chars":2000,"max_response_chars":1200}' check(jsonb_typeof(ai_policy)='object');
alter table public.whatsapp_usage add column cached_input_tokens integer not null default 0 check(cached_input_tokens>=0),
 add column reserved_usd numeric(16,8) not null default 0.02 check(reserved_usd>=0);
create index whatsapp_jobs_restaurant_rate on public.whatsapp_jobs(restaurant_id,created_at) where direction='in';

create function public.whatsapp_menu_context(p_restaurant uuid,p_terms text[],p_ids uuid[])
returns setof public.menu_items language sql stable set search_path='' as $$
 with scored as (select m.id,
  case when m.id=any(p_ids) then 1000 else 0 end +
  (select count(*) from unnest(p_terms[1:8]) t where length(t) between 2 and 32 and
   translate(m.name||' '||coalesce(m.category,''),'أإآىةگڨ','ااايهكك') ilike '%'||replace(replace(t,'%',''),'_','')||'%') score
  from public.menu_items m where m.restaurant_id=p_restaurant)
 select m.* from scored s join public.menu_items m on m.id=s.id and m.restaurant_id=p_restaurant
 where s.score>0 or not exists(select 1 from scored where score>0)
 order by s.score desc,m.is_available desc,m.id limit 24
$$;

-- The settings row serializes per-tenant admission, quota and spend decisions.
-- Persist admission so crash retries cannot batch or charge admission twice.
create function public.whatsapp_prepare_inbound(p_job uuid,p_lease uuid) returns jsonb language plpgsql set search_path='' as $$
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
 elsif j.kind='text' and exists(select 1 from public.whatsapp_jobs old where old.conversation_id=j.conversation_id and old.direction='in' and old.seq<j.seq and old.created_at>=j.created_at-interval '1 minute'
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

create function public.whatsapp_scope_notice(p_job uuid,p_lease uuid,p_reason text default 'scope') returns boolean language plpgsql set search_path='' as $$
declare j public.whatsapp_jobs; allowed boolean;
begin
 if p_reason not in ('scope','ai_budget','ai_unavailable','unsupported') then return false; end if;
 select * into j from public.whatsapp_jobs where id=p_job and lease=p_lease and state='processing' and run_at>now() for update;
 if not found then return false; end if;
 perform 1 from public.whatsapp_settings where restaurant_id=j.restaurant_id for update;
 allowed:=(select count(*) from public.whatsapp_jobs where conversation_id=j.conversation_id and id<>j.id and payload->>'guard_reason'=p_reason and created_at>=now()-interval '10 minutes')<case when p_reason='scope' then 2 else 1 end;
 update public.whatsapp_jobs set payload=payload||jsonb_build_object('guard_reason',p_reason) where id=j.id;
 return allowed;
end $$;

create function public.whatsapp_reserve_ai(p_job uuid,p_lease uuid,p_model text,p_reserved_usd numeric) returns boolean language plpgsql set search_path='' as $$
declare j public.whatsapp_jobs; s public.whatsapp_settings; p jsonb;
begin
 select * into j from public.whatsapp_jobs where id=p_job and lease=p_lease and direction='in' and state='processing' and run_at>now() for update;
 if not found then return false; end if;
 select * into s from public.whatsapp_settings where restaurant_id=j.restaurant_id for update;
 if not found or not s.enabled or not public.restaurant_subscription_active(j.restaurant_id) then return false; end if;
 p:=s.ai_policy;
 if p_reserved_usd is null or p_reserved_usd<0 or p_reserved_usd>coalesce((p->>'request_max_usd')::numeric,0.02) then return false; end if;
 if (select count(*) from public.whatsapp_usage where restaurant_id=j.restaurant_id and created_at>=date_trunc('day',now(),'UTC'))>=s.daily_ai_limit
  or (select count(*) from public.whatsapp_usage where restaurant_id=j.restaurant_id and created_at>=date_trunc('month',now(),'UTC'))>=coalesce((p->>'monthly_requests')::int,4500)
  or (select count(*) from public.whatsapp_usage where restaurant_id=j.restaurant_id and created_at>=now()-interval '1 minute')>=30
  or (select coalesce(sum(greatest(coalesce(estimated_usd,0),reserved_usd)),0) from public.whatsapp_usage where restaurant_id=j.restaurant_id and created_at>=date_trunc('day',now(),'UTC'))+p_reserved_usd>coalesce((p->>'daily_budget_usd')::numeric,1)
  or (select coalesce(sum(greatest(coalesce(estimated_usd,0),reserved_usd)),0) from public.whatsapp_usage where restaurant_id=j.restaurant_id and created_at>=date_trunc('month',now(),'UTC'))+p_reserved_usd>coalesce((p->>'monthly_budget_usd')::numeric,10) then return false; end if;
 insert into public.whatsapp_usage(job_id,attempt,restaurant_id,conversation_id,model,reserved_usd) values(j.id,j.attempts,j.restaurant_id,j.conversation_id,p_model,p_reserved_usd) on conflict do nothing;
 return found;
end $$;
create or replace function public.whatsapp_reserve_ai(p_job uuid,p_lease uuid,p_model text) returns boolean language sql set search_path='' as $$ select public.whatsapp_reserve_ai(p_job,p_lease,p_model,0.02) $$;

create table public.whatsapp_metrics(restaurant_id uuid not null references public.restaurants on delete cascade,day date not null,inbound_events bigint not null default 0,duplicate_events bigint not null default 0,primary key(restaurant_id,day));
alter table public.whatsapp_metrics enable row level security;
revoke all on public.whatsapp_metrics from public,anon,authenticated;
grant all on public.whatsapp_metrics to service_role;
alter function public.whatsapp_ingest(jsonb) rename to whatsapp_ingest_core;
create function public.whatsapp_ingest(p_events jsonb) returns integer language plpgsql set search_path='' as $$
declare a public.whatsapp_accounts; e jsonb; received integer; duplicates integer;
begin
 for a in select * from public.whatsapp_accounts where status='connected' and subscribed and exists(select 1 from jsonb_array_elements(p_events) x where x->>'phone'=phone_id and x->>'waba'=waba_id) order by restaurant_id loop
  received:=0; duplicates:=0;
  for e in select value from jsonb_array_elements(p_events) where value->>'phone'=a.phone_id and value->>'waba'=a.waba_id and value->>'kind' in ('text','button','unsupported') loop
   received:=received+1;
   if exists(select 1 from public.whatsapp_jobs j join public.whatsapp_conversations c on c.id=j.conversation_id where j.restaurant_id=a.restaurant_id and c.phone_id=a.phone_id and j.direction='in' and j.dedupe_key=e->>'provider_id') then duplicates:=duplicates+1; end if;
  end loop;
  if received>0 then insert into public.whatsapp_metrics values(a.restaurant_id,(now() at time zone 'UTC')::date,received,duplicates)
   on conflict(restaurant_id,day) do update set inbound_events=whatsapp_metrics.inbound_events+excluded.inbound_events,duplicate_events=whatsapp_metrics.duplicate_events+excluded.duplicate_events; end if;
 end loop;
 return public.whatsapp_ingest_core(p_events);
end $$;

create or replace function public.whatsapp_usage_summary(p_restaurant uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('attempts',count(*),'measured',count(input_tokens),'input_tokens',coalesce(sum(input_tokens),0),
  'cached_input_tokens',coalesce(sum(cached_input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0),'estimated_usd',sum(estimated_usd),'estimated_attempts',count(estimated_usd),'reserved_usd',coalesce(sum(reserved_usd),0),
  'inbound_messages',(select count(*) from public.whatsapp_jobs where restaurant_id=p_restaurant and direction='in' and created_at>=date_trunc('month',now(),'UTC')),
  'outbound_messages',(select count(*) from public.whatsapp_jobs where restaurant_id=p_restaurant and direction='out' and provider_id is not null and created_at>=date_trunc('month',now(),'UTC')),
  'blocked_requests',(select count(*) from public.whatsapp_jobs where restaurant_id=p_restaurant and payload ? 'guard_reason' and payload->>'guard_reason'<>'batched' and created_at>=date_trunc('month',now(),'UTC')),
  'batched_messages',(select count(*) from public.whatsapp_jobs where restaurant_id=p_restaurant and payload->>'guard_reason'='batched' and created_at>=date_trunc('month',now(),'UTC')),
  'duplicate_events',(select coalesce(sum(duplicate_events),0) from public.whatsapp_metrics where restaurant_id=p_restaurant and day>=date_trunc('month',now(),'UTC')::date))
 from public.whatsapp_usage where restaurant_id=p_restaurant and created_at>=date_trunc('month',now(),'UTC')
$$;
alter function public.whatsapp_prune() rename to whatsapp_prune_core;
create function public.whatsapp_prune() returns void language plpgsql set search_path='' as $$ begin perform public.whatsapp_prune_core(); delete from public.whatsapp_metrics where day<current_date-90; end $$;
revoke execute on function public.whatsapp_prepare_inbound(uuid,uuid),public.whatsapp_scope_notice(uuid,uuid,text),public.whatsapp_reserve_ai(uuid,uuid,text,numeric),public.whatsapp_ingest(jsonb),public.whatsapp_prune(),public.whatsapp_menu_context(uuid,text[],uuid[]) from public,anon,authenticated;
grant execute on function public.whatsapp_prepare_inbound(uuid,uuid),public.whatsapp_scope_notice(uuid,uuid,text),public.whatsapp_reserve_ai(uuid,uuid,text,numeric),public.whatsapp_ingest(jsonb),public.whatsapp_prune(),public.whatsapp_menu_context(uuid,text[],uuid[]) to service_role;
commit;
