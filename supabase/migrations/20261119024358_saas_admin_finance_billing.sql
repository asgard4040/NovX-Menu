begin;
alter table public.whatsapp_settings add column runtime_config jsonb not null default '{}';
alter table public.whatsapp_usage add column pricing_snapshot jsonb, add column latency_ms integer check(latency_ms>=0);
create table public.saas_plans(
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100),
 version integer not null check(version>0), currency text not null check(currency in ('IQD','USD')),
 monthly_price numeric(18,2) not null check(monthly_price>=0), effective_at timestamptz not null,
 active boolean not null default true, public boolean not null default false,
 limits jsonb not null default '{}', features jsonb not null default '{}',
 overage_rate numeric(18,4) not null default 0 check(overage_rate>=0), unique(name,version),
 check(jsonb_typeof(limits)='object'),check(jsonb_typeof(features)='object'));
create table public.saas_subscriptions(
 restaurant_id uuid primary key references public.restaurants, plan_id uuid not null references public.saas_plans,
 status text not null check(status in ('trial','active','past_due','grace','suspended','cancelled','expired')),
 period_start timestamptz not null, period_end timestamptz not null, grace_end timestamptz,
 price numeric(18,2) not null check(price>=0), currency text not null check(currency in ('IQD','USD')),
 overrides jsonb not null default '{}', overage_accepted boolean not null default false, acceptance_reference text,
 check(period_end>period_start), check(jsonb_typeof(overrides)='object'));
create table public.saas_fx_rates(
 effective_date date primary key, iqd_per_usd numeric(18,6) not null check(iqd_per_usd>0));
create table public.saas_invoices(
 id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
 restaurant_id uuid not null references public.restaurants, subscription_plan uuid references public.saas_plans,
 period_start timestamptz not null, period_end timestamptz not null, due_at timestamptz not null,
 currency text not null check(currency in ('IQD','USD')), fx numeric(18,6) not null check(fx>0),
 plan_amount numeric(18,2) not null check(plan_amount>=0), overage numeric(18,2) not null default 0 check(overage>=0),
 discount numeric(18,2) not null default 0 check(discount>=0), tax numeric(18,2) not null default 0 check(tax>=0),
 total numeric(18,2) generated always as (plan_amount+overage-discount+tax) stored,
 issued_at timestamptz not null default now(), notes text not null default '',
 unique(restaurant_id,period_start,period_end),check(period_end>period_start),check(discount<=plan_amount+overage));
create table public.saas_payments(
 id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.saas_invoices,
 amount numeric(18,2) not null check(amount<>0), paid_at timestamptz not null default now(),
 method text not null check(length(method) between 1 and 100), reference text not null unique,
 refund_of uuid references public.saas_payments, check((amount<0)=(refund_of is not null)));
create table public.saas_expenses(
 id uuid primary key default gen_random_uuid(), restaurant_id uuid references public.restaurants,
 category text not null, vendor text not null, description text not null,
 amount numeric(18,2) not null check(amount<>0),currency text not null check(currency in ('IQD','USD')),
 fx numeric(18,6) not null check(fx>0), expense_date date not null, paid_date date,
 cost_class text not null check(cost_class in ('direct','operating','tax')),
 source_reference text not null unique, correction_of uuid references public.saas_expenses,
 notes text not null default '',check(amount>0 or correction_of is not null));
create index saas_payments_invoice on public.saas_payments(invoice_id,paid_at);
create index saas_invoices_issued on public.saas_invoices(issued_at,restaurant_id);
create index saas_subscriptions_expiry on public.saas_subscriptions(status,period_end);
create index saas_expenses_date on public.saas_expenses(expense_date,restaurant_id);
create table public.saas_audit(
 id bigint generated always as identity primary key, actor uuid, action text not null,
 record_id text, before_data jsonb, after_data jsonb, created_at timestamptz not null default now());
create table public.saas_sessions(
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants,
 conversation_id uuid,
 started_at timestamptz not null,ends_at timestamptz not null,unique(conversation_id,started_at),foreign key(restaurant_id,conversation_id) references public.whatsapp_conversations(restaurant_id,id) on delete set null (conversation_id));
create index saas_sessions_period on public.saas_sessions(restaurant_id,started_at);
-- Fixed, non-sliding 24-hour ORDOVA session. It is not a Meta billing unit.
create function public.saas_meter_session() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.direction='in' then
  perform pg_advisory_xact_lock(hashtextextended(new.restaurant_id::text,173));
  if not exists(select 1 from public.saas_sessions where conversation_id=new.conversation_id and started_at<=new.created_at and ends_at>new.created_at) then
   insert into public.saas_sessions(restaurant_id,conversation_id,started_at,ends_at) values(new.restaurant_id,new.conversation_id,new.created_at,new.created_at+interval '24 hours');
  end if;
 end if;return new;
end $$;
create trigger saas_session_meter after insert on public.whatsapp_jobs for each row execute function public.saas_meter_session();
create function public.saas_audit_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.saas_audit(actor,action,record_id,before_data,after_data) values(auth.uid(),tg_table_name||':'||tg_op,
 coalesce(to_jsonb(new)->>'id',to_jsonb(new)->>'restaurant_id',to_jsonb(new)->>'effective_date'),case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new));return new;
end $$;
create function public.saas_immutable() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'immutable_record_use_correction';end $$;
do $$ declare t text;begin
 foreach t in array array['saas_plans','saas_subscriptions','saas_fx_rates','saas_invoices','saas_payments','saas_expenses'] loop
  execute format('create trigger audit_change after insert or update on public.%I for each row execute function public.saas_audit_change()',t);
 end loop;
 foreach t in array array['saas_plans','saas_fx_rates','saas_invoices','saas_payments','saas_expenses','saas_audit'] loop
  execute format('create trigger immutable before update or delete on public.%I for each row execute function public.saas_immutable()',t);
 end loop;
 foreach t in array array['saas_plans','saas_subscriptions','saas_fx_rates','saas_invoices','saas_payments','saas_expenses','saas_audit','saas_sessions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy platform_admin_read on public.%I for select to authenticated using ((select public.is_system_admin()))',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
-- Only the narrow RPCs below mutate financial records. No client table writes.
create function public.saas_admin_command(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; inv public.saas_invoices; sub public.saas_subscriptions; plan public.saas_plans; rate numeric; original public.saas_payments; amount numeric; used bigint; original_expense public.saas_expenses;
begin
 if not public.is_system_admin() then raise exception 'admin_required' using errcode='42501';end if;
 if p_action='ai' then
  if (p_data->>'daily_ai_limit')::int not between 1 and 500 or (p_data->>'monthly_budget_usd')::numeric not between 0 and 10000 or (p_data->>'customer_rpm')::int not between 1 and 60 then raise exception 'invalid_ai_policy';end if;
  update public.whatsapp_settings set enabled=(p_data->>'enabled')::boolean,daily_ai_limit=(p_data->>'daily_ai_limit')::int,
   ai_policy=ai_policy||jsonb_build_object('monthly_budget_usd',(p_data->>'monthly_budget_usd')::numeric,'customer_rpm',(p_data->>'customer_rpm')::int)
   where restaurant_id=(p_data->>'restaurant_id')::uuid returning to_jsonb(whatsapp_settings.*) into r;
  if r is null then raise exception 'whatsapp_settings_missing';end if;
  insert into public.saas_audit(actor,action,record_id,after_data) values(auth.uid(),'ai_policy',(p_data->>'restaurant_id'),p_data);
 elsif p_action='model' then
  if p_data->>'model' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,100}$' or (p_data->>'input_rate')::numeric not between 0 and 10000 or (p_data->>'output_rate')::numeric not between 0 and 10000 or (p_data->>'cached_rate')::numeric not between 0 and 10000 or (p_data->>'max_output_tokens')::int not between 800 and 4000 or (p_data->>'timeout_ms')::int not between 2000 and 16000 then raise exception 'invalid_model_config';end if;
  if p_data->>'model' is null or p_data->>'input_rate' is null or p_data->>'output_rate' is null or p_data->>'cached_rate' is null or p_data->>'max_output_tokens' is null or p_data->>'timeout_ms' is null then raise exception 'model_config_required';end if;
  update public.whatsapp_settings set runtime_config=jsonb_build_object('model',p_data->>'model','input',(p_data->>'input_rate')::numeric,'output',(p_data->>'output_rate')::numeric,'cached',(p_data->>'cached_rate')::numeric,'max_output_tokens',(p_data->>'max_output_tokens')::int,'timeout_ms',(p_data->>'timeout_ms')::int,'effective_at',now()) where restaurant_id=(p_data->>'restaurant_id')::uuid returning runtime_config into r;
  if r is null then raise exception 'whatsapp_settings_missing';end if;
  insert into public.saas_audit(actor,action,record_id,after_data) values(auth.uid(),'model_config',p_data->>'restaurant_id',r);
 elsif p_action='plan' then
  if exists(select 1 from jsonb_each_text(coalesce(p_data->'limits','{}')) e where e.key not in ('conversations','inbound','ai_responses') or e.value !~ '^[0-9]{1,9}$') then raise exception 'invalid_limits';end if;
  insert into public.saas_plans(name,version,currency,monthly_price,effective_at,active,public,limits,features,overage_rate)
  values(p_data->>'name',(p_data->>'version')::int,p_data->>'currency',(p_data->>'monthly_price')::numeric,(p_data->>'effective_at')::timestamptz,coalesce((p_data->>'active')::boolean,true),coalesce((p_data->>'public')::boolean,false),coalesce(p_data->'limits','{}'),coalesce(p_data->'features','{}'),coalesce((p_data->>'overage_rate')::numeric,0)) returning to_jsonb(saas_plans.*) into r;
 elsif p_action='assign' then
  select * into strict plan from public.saas_plans where id=(p_data->>'plan_id')::uuid and active and effective_at<=now();
  if exists(select 1 from jsonb_each_text(coalesce(p_data->'overrides','{}')) e where e.key not in ('conversations','inbound','ai_responses') or e.value !~ '^[0-9]{1,9}$') then raise exception 'invalid_limits';end if;
  select * into sub from public.saas_subscriptions where restaurant_id=(p_data->>'restaurant_id')::uuid for update;
  if found and sub.period_end>now() and (p_data->>'period_start')::timestamptz<sub.period_end and (plan.id<>sub.plan_id or coalesce((p_data->>'price')::numeric,plan.monthly_price)<>sub.price) then raise exception 'mid_cycle_price_change_not_supported';end if;
  if coalesce((p_data->>'overage_accepted')::boolean,false) and length(coalesce(p_data->>'acceptance_reference',''))<8 then raise exception 'overage_acceptance_evidence_required';end if;
  insert into public.saas_subscriptions(restaurant_id,plan_id,status,period_start,period_end,grace_end,price,currency,overrides,overage_accepted,acceptance_reference)
  values((p_data->>'restaurant_id')::uuid,plan.id,p_data->>'status',(p_data->>'period_start')::timestamptz,(p_data->>'period_end')::timestamptz,(p_data->>'grace_end')::timestamptz,coalesce((p_data->>'price')::numeric,plan.monthly_price),plan.currency,coalesce(p_data->'overrides','{}'),coalesce((p_data->>'overage_accepted')::boolean,false),p_data->>'acceptance_reference')
  on conflict(restaurant_id) do update set plan_id=excluded.plan_id,status=excluded.status,period_start=excluded.period_start,period_end=excluded.period_end,grace_end=excluded.grace_end,price=excluded.price,currency=excluded.currency,overrides=excluded.overrides,overage_accepted=excluded.overage_accepted,acceptance_reference=excluded.acceptance_reference
  returning to_jsonb(saas_subscriptions.*) into r;
 elsif p_action='fx' then
  insert into public.saas_fx_rates values((p_data->>'effective_date')::date,(p_data->>'iqd_per_usd')::numeric) returning to_jsonb(saas_fx_rates.*) into r;
 elsif p_action='invoice' then
  select * into strict sub from public.saas_subscriptions where restaurant_id=(p_data->>'restaurant_id')::uuid for update;
  if sub.status not in ('active','past_due','grace') then raise exception 'subscription_not_billable';end if;
  if sub.overage_accepted and sub.period_end>now() then raise exception 'overage_period_not_closed';end if;
  if exists(select 1 from public.saas_invoices i where i.restaurant_id=sub.restaurant_id and tstzrange(i.period_start,i.period_end,'[)') && tstzrange(sub.period_start,sub.period_end,'[)') and (i.period_start<>sub.period_start or i.period_end<>sub.period_end)) then raise exception 'overlapping_invoice_period';end if;
  select * into strict plan from public.saas_plans where id=sub.plan_id;
  select iqd_per_usd into rate from public.saas_fx_rates where effective_date<=(sub.period_start at time zone 'Asia/Baghdad')::date order by effective_date desc limit 1;
  if sub.currency='USD' and rate is null then raise exception 'exchange_rate_required';end if;
  select count(*) into used from public.saas_sessions where restaurant_id=sub.restaurant_id and started_at>=sub.period_start and started_at<least(now(),sub.period_end);
  insert into public.saas_invoices(restaurant_id,subscription_plan,period_start,period_end,due_at,currency,fx,plan_amount,overage,discount,tax,notes)
  values(sub.restaurant_id,sub.plan_id,sub.period_start,sub.period_end,coalesce((p_data->>'due_at')::timestamptz,sub.period_end),sub.currency,case when sub.currency='IQD' then 1 else rate end,sub.price,
   case when sub.overage_accepted and sub.period_end<=now() then greatest(0,used-coalesce((sub.overrides->>'conversations')::bigint,(plan.limits->>'conversations')::bigint,used))*plan.overage_rate else 0 end,
   coalesce((p_data->>'discount')::numeric,0),coalesce((p_data->>'tax')::numeric,0),coalesce(p_data->>'notes',''))
  on conflict(restaurant_id,period_start,period_end) do nothing returning to_jsonb(saas_invoices.*) into r;
  if r is null then select to_jsonb(i.*) into r from public.saas_invoices i where restaurant_id=sub.restaurant_id and period_start=sub.period_start and period_end=sub.period_end;end if;
 elsif p_action='payment' then
  select * into strict inv from public.saas_invoices where id=(p_data->>'invoice_id')::uuid for update;
  select * into original from public.saas_payments where reference=p_data->>'reference';
  if found then
   if original.invoice_id=inv.id and original.amount=(p_data->>'amount')::numeric and original.refund_of is not distinct from (p_data->>'refund_of')::uuid then return to_jsonb(original);end if;
   raise exception 'payment_reference_conflict';
  end if;
  if coalesce((p_data->>'paid_at')::timestamptz,now())>now() then raise exception 'future_payment_not_collected';end if;
  amount:=(p_data->>'amount')::numeric;
  if (p_data->>'refund_of') is not null then
   select * into strict original from public.saas_payments p where p.id=(p_data->>'refund_of')::uuid and p.invoice_id=inv.id and p.amount>0 for update;
   if coalesce((p_data->>'paid_at')::timestamptz,now())<original.paid_at then raise exception 'refund_precedes_payment';end if;
   if amount>=0 or -amount>original.amount+coalesce((select sum(p.amount) from public.saas_payments p where refund_of=original.id),0) then raise exception 'invalid_refund';end if;
  elsif amount<=0 or amount>inv.total-coalesce((select sum(p.amount) from public.saas_payments p where invoice_id=inv.id),0) then raise exception 'invalid_payment';end if;
  insert into public.saas_payments(invoice_id,amount,paid_at,method,reference,refund_of) values(inv.id,amount,coalesce((p_data->>'paid_at')::timestamptz,now()),p_data->>'method',p_data->>'reference',(p_data->>'refund_of')::uuid) returning to_jsonb(saas_payments.*) into r;
 elsif p_action='expense' then
  select iqd_per_usd into rate from public.saas_fx_rates where effective_date<=(p_data->>'expense_date')::date order by effective_date desc limit 1;
  if p_data->>'currency'='USD' and rate is null then raise exception 'exchange_rate_required';end if;
  if (p_data->>'amount')::numeric<0 then
   select * into strict original_expense from public.saas_expenses where id=(p_data->>'correction_of')::uuid and amount>0 for update;
   if original_expense.currency<>p_data->>'currency' or original_expense.restaurant_id is distinct from (p_data->>'restaurant_id')::uuid or -(p_data->>'amount')::numeric>original_expense.amount+coalesce((select sum(e.amount) from public.saas_expenses e where correction_of=original_expense.id and e.amount<0),0) then raise exception 'invalid_expense_reversal';end if;
   rate:=original_expense.fx;
  end if;
  insert into public.saas_expenses(restaurant_id,category,vendor,description,amount,currency,fx,expense_date,paid_date,cost_class,source_reference,correction_of,notes)
  values((p_data->>'restaurant_id')::uuid,p_data->>'category',p_data->>'vendor',p_data->>'description',(p_data->>'amount')::numeric,p_data->>'currency',case when p_data->>'currency'='IQD' then 1 else rate end,(p_data->>'expense_date')::date,(p_data->>'paid_date')::date,p_data->>'cost_class',p_data->>'source_reference',(p_data->>'correction_of')::uuid,coalesce(p_data->>'notes','')) returning to_jsonb(saas_expenses.*) into r;
 else raise exception 'unsupported_action';end if;
 return r;
end $$;
-- Concurrency-safe quota gate, layered on the existing admission/spam policy.
alter function public.whatsapp_prepare_inbound(uuid,uuid) rename to whatsapp_prepare_before_saas;
create function public.whatsapp_prepare_inbound(p_job uuid,p_lease uuid) returns jsonb language plpgsql set search_path='' as $$
declare j public.whatsapp_jobs; sub public.saas_subscriptions; limits jsonb; reason text; result jsonb; used bigint;
begin
 select * into j from public.whatsapp_jobs where id=p_job and lease=p_lease and state='processing';
 if not found then return jsonb_build_object('gate','skip');end if;
 perform pg_advisory_xact_lock(hashtextextended(j.restaurant_id::text,173));
 select * into sub from public.saas_subscriptions where restaurant_id=j.restaurant_id for share;
 if found then
  select p.limits||sub.overrides into limits from public.saas_plans p where id=sub.plan_id;
  if sub.status not in ('trial','active','grace') or now()<sub.period_start or now()>=coalesce(case when sub.status='grace' then sub.grace_end end,sub.period_end) then reason:='subscription_inactive';
  elsif limits ? 'conversations' and not sub.overage_accepted and (select count(*) from public.saas_sessions where restaurant_id=j.restaurant_id and started_at>=sub.period_start and started_at<sub.period_end)>(limits->>'conversations')::bigint then reason:='conversation_quota';
  elsif limits ? 'inbound' and (select count(*) from public.whatsapp_jobs where restaurant_id=j.restaurant_id and direction='in' and created_at>=sub.period_start and created_at<sub.period_end)>(limits->>'inbound')::bigint then reason:='inbound_quota';
  elsif limits ? 'ai_responses' and (select count(*) from public.whatsapp_jobs where restaurant_id=j.restaurant_id and direction='out' and kind='reply' and created_at>=sub.period_start and created_at<sub.period_end)>=(limits->>'ai_responses')::bigint then reason:='response_quota';end if;
 end if;
 if reason is not null then update public.whatsapp_jobs set payload=payload||jsonb_build_object('guard_reason',reason,'admission','skip') where id=j.id;return jsonb_build_object('gate','skip');end if;
 return public.whatsapp_prepare_before_saas(p_job,p_lease);
end $$;
revoke execute on function public.saas_admin_command(text,jsonb) from public,anon;
grant execute on function public.saas_admin_command(text,jsonb) to authenticated;
revoke execute on function public.saas_meter_session(),public.saas_audit_change(),public.saas_immutable(),public.whatsapp_prepare_before_saas(uuid,uuid),public.whatsapp_prepare_inbound(uuid,uuid) from public,anon,authenticated;
grant execute on function public.whatsapp_prepare_inbound(uuid,uuid) to service_role;

create function public.saas_admin_report(p_start date,p_end date,p_restaurant uuid default null,p_offset int default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare begins timestamptz; ends timestamptz; result jsonb;
begin
 if not public.is_system_admin() then raise exception 'admin_required' using errcode='42501';end if;
 if p_end<p_start or p_end-p_start>1096 or p_offset<0 then raise exception 'invalid_period';end if;
 begins:=p_start::timestamp at time zone 'Asia/Baghdad';ends:=(p_end+1)::timestamp at time zone 'Asia/Baghdad';
 with inv as (select i.*, greatest(0,extract(epoch from least(ends,period_end)-greatest(begins,period_start)))/extract(epoch from period_end-period_start) fraction,
 coalesce((select sum(p.amount) from public.saas_payments p where p.invoice_id=i.id and p.paid_at<ends),0) paid
 from public.saas_invoices i where (p_restaurant is null or restaurant_id=p_restaurant) and issued_at<ends),
 exp as(select * from public.saas_expenses where expense_date>=p_start and expense_date<=p_end and (p_restaurant is null or restaurant_id=p_restaurant)),
 kpi as(select coalesce(sum((total-tax)*fx*fraction),0) earned,coalesce(sum(greatest(0,total-paid)*fx),0) receivable from inv),
 cash as(select coalesce(sum(p.amount*i.fx),0) collected from public.saas_payments p join inv i on i.id=p.invoice_id where p.paid_at>=begins and p.paid_at<ends),
 costs as(select coalesce(sum(amount*fx) filter(where cost_class='direct'),0) direct,coalesce(sum(amount*fx) filter(where cost_class='operating'),0) operating,coalesce(sum(amount*fx) filter(where cost_class='tax'),0) tax,coalesce(sum(amount*fx) filter(where paid_date between p_start and p_end),0) cash_paid from exp)
 select jsonb_build_object('currency','IQD','earned',k.earned,'receivable',k.receivable,'manual_collected',c.collected,'direct_cost',x.direct,'operating_cost',x.operating,'tax',x.tax,
 'gross_profit',k.earned-x.direct,'operating_profit',k.earned-x.direct-x.operating,'net_profit',k.earned-x.direct-x.operating-x.tax,'cash_expenses',coalesce((select sum(e.amount*e.fx) from public.saas_expenses e where paid_date between p_start and p_end and (p_restaurant is null or e.restaurant_id=p_restaurant)),0),
 'net_margin',case when k.earned>0 then (k.earned-x.direct-x.operating-x.tax)*100/k.earned end,
 'gateway_collected',coalesce((select sum(amount_iqd) from public.subscription_payments where status='paid' and environment='live' and paid_at>=begins and paid_at<ends and (p_restaurant is null or restaurant_id=p_restaurant)),0),
 'paid_monthly_mrr',coalesce((select sum((i.plan_amount-i.discount)*i.fx) from public.saas_subscriptions s join public.saas_invoices i on i.restaurant_id=s.restaurant_id and i.period_start=s.period_start and i.period_end=s.period_end where s.status='active' and s.period_start<=now() and s.period_end>now() and s.period_end=s.period_start+interval '1 month' and (select coalesce(sum(p.amount),0) from public.saas_payments p where p.invoice_id=i.id)>=i.total and (p_restaurant is null or s.restaurant_id=p_restaurant)),0),
 'restaurants',(select count(*) from public.restaurants where p_restaurant is null or id=p_restaurant),
 'active_subscriptions',(select count(*) from public.saas_subscriptions where status='active' and period_start<=now() and period_end>now() and (p_restaurant is null or restaurant_id=p_restaurant)),
 'ai',(select jsonb_build_object('requests',count(*),'average_latency_ms',avg(latency_ms),'input_tokens',sum(input_tokens),'cached_tokens',sum(cached_input_tokens),'output_tokens',sum(output_tokens),'estimated_usd',sum(estimated_usd),'unmeasured',count(*) filter(where estimated_usd is null)) from public.whatsapp_usage where created_at>=begins and created_at<ends and (p_restaurant is null or restaurant_id=p_restaurant)),
 'messaging',(select jsonb_build_object('inbound',count(*) filter(where direction='in'),'outbound',count(*) filter(where direction='out'),'notifications',count(*) filter(where direction='out' and kind='order_status'),'failed',count(*) filter(where state='failed'),'blocked',count(*) filter(where payload ? 'guard_reason'),'scope_flags',count(*) filter(where payload->>'guard_reason'='scope'),'spam',count(*) filter(where payload->>'guard_reason'='repeated_message'),'read',count(*) filter(where state='read')) from public.whatsapp_jobs where created_at>=begins and created_at<ends and (p_restaurant is null or restaurant_id=p_restaurant)),
 'alerts',jsonb_build_object('overdue_invoices',(select count(*) from inv where due_at<least(now(),ends) and paid<total),'provider_failures',(select count(*) from public.whatsapp_accounts where status='reconnect_required' and (p_restaurant is null or restaurant_id=p_restaurant)),'expiring_subscriptions',(select count(*) from public.saas_subscriptions where status='active' and period_end between now() and now()+interval '7 days' and (p_restaurant is null or restaurant_id=p_restaurant))),
 'sessions',(select count(*) from public.saas_sessions where started_at>=begins and started_at<ends and (p_restaurant is null or restaurant_id=p_restaurant)),
 'expense_categories',(select coalesce(jsonb_agg(t),'[]') from(select category,sum(amount*fx) amount_iqd from exp group by category) t),
 'models',(select coalesce(jsonb_agg(t),'[]') from(select model,count(*) requests,sum(input_tokens) input_tokens,sum(output_tokens) output_tokens,sum(estimated_usd) estimated_usd from public.whatsapp_usage where created_at>=begins and created_at<ends and (p_restaurant is null or restaurant_id=p_restaurant) group by model) t),
 'profitability',(select coalesce(jsonb_agg(t),'[]') from(select r.id,r.restaurant_name,
 coalesce((select sum((total-tax)*fx*fraction) from inv where restaurant_id=r.id),0) revenue,
 coalesce((select sum(amount*fx) from exp where restaurant_id=r.id),0) attributable_cost,
 coalesce((select sum(greatest(0,total-paid)*fx) from inv where restaurant_id=r.id),0) outstanding,
 (select sum(estimated_usd) from public.whatsapp_usage u where u.restaurant_id=r.id and created_at>=begins and created_at<ends) estimated_ai_usd
 from public.restaurants r where p_restaurant is null or r.id=p_restaurant order by r.restaurant_name,r.id limit 50 offset p_offset) t),
 'series',(select coalesce(jsonb_agg(t),'[]') from(select d::date as date,
 coalesce((select sum((i.total-i.tax)*i.fx*greatest(0,extract(epoch from least((d+interval '1 day') at time zone 'Asia/Baghdad',i.period_end)-greatest(d at time zone 'Asia/Baghdad',i.period_start)))/extract(epoch from i.period_end-i.period_start)) from inv i),0) earned,
 coalesce((select sum(e.amount*e.fx) from exp e where e.expense_date=d::date),0) expenses
 from generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d order by d) t)) into result from kpi k cross join cash c cross join costs x;
 return result;
end $$;
create function public.saas_admin_list(p_resource text,p_offset int default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_system_admin() then raise exception 'admin_required' using errcode='42501';end if;
 if p_offset<0 then raise exception 'invalid_offset';end if;
 if p_resource='plans' then select coalesce(jsonb_agg(t),'[]') into result from(select * from public.saas_plans order by effective_at desc,id limit 50 offset p_offset) t;
 elsif p_resource='subscriptions' then select coalesce(jsonb_agg(t),'[]') into result from(select s.*,r.restaurant_name,p.name plan_name,p.limits||s.overrides limits,(select count(*) from public.saas_sessions x where x.restaurant_id=s.restaurant_id and started_at>=period_start and started_at<period_end) sessions from public.saas_subscriptions s join public.restaurants r on r.id=s.restaurant_id join public.saas_plans p on p.id=s.plan_id order by s.period_end,s.restaurant_id limit 50 offset p_offset)t;
 elsif p_resource='invoices' then select coalesce(jsonb_agg(t),'[]') into result from(select i.*,r.restaurant_name,coalesce((select sum(amount) from public.saas_payments p where p.invoice_id=i.id),0) paid from public.saas_invoices i join public.restaurants r on r.id=i.restaurant_id order by number desc limit 50 offset p_offset)t;
 elsif p_resource='expenses' then select coalesce(jsonb_agg(t),'[]') into result from(select * from public.saas_expenses order by expense_date desc,id limit 50 offset p_offset)t;
 elsif p_resource='payments' then select coalesce(jsonb_agg(t),'[]') into result from(select * from public.saas_payments order by paid_at desc,id limit 50 offset p_offset)t;
 elsif p_resource='audit' then select coalesce(jsonb_agg(t),'[]') into result from(select id,actor,action,record_id,created_at from public.saas_audit order by id desc limit 50 offset p_offset)t;
 elsif p_resource='connections' then select coalesce(jsonb_agg(t),'[]') into result from(select a.restaurant_id,r.restaurant_name,a.provider,a.status,a.display_phone,a.gupshup_app_name,a.last_error,a.last_webhook_at,s.enabled,s.ai_policy,s.daily_ai_limit,s.runtime_config from public.whatsapp_accounts a join public.restaurants r on r.id=a.restaurant_id left join public.whatsapp_settings s on s.restaurant_id=a.restaurant_id order by r.restaurant_name,a.restaurant_id limit 50 offset p_offset)t;
 elsif p_resource='restaurants' then select coalesce(jsonb_agg(t),'[]') into result from(select id,restaurant_name from public.restaurants order by restaurant_name,id limit 50 offset p_offset)t;
 else raise exception 'unsupported_resource';end if;return result;
end $$;
revoke execute on function public.saas_admin_report(date,date,uuid,int),public.saas_admin_list(text,int) from public,anon;
grant execute on function public.saas_admin_report(date,date,uuid,int),public.saas_admin_list(text,int) to authenticated;
alter function public.whatsapp_reserve_ai(uuid,uuid,text,numeric) rename to whatsapp_reserve_before_saas;
create function public.whatsapp_reserve_ai(p_job uuid,p_lease uuid,p_model text,p_reserved_usd numeric) returns boolean language plpgsql set search_path='' as $$
declare j public.whatsapp_jobs; s public.saas_subscriptions; limits jsonb;
begin
 select * into j from public.whatsapp_jobs where id=p_job and lease=p_lease and state='processing';if not found then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(j.restaurant_id::text,173));
 select * into s from public.saas_subscriptions where restaurant_id=j.restaurant_id for share;
 if found then
  select p.limits||s.overrides into limits from public.saas_plans p where id=s.plan_id;
  if s.status not in ('active','trial','grace') or now()<s.period_start or now()>=coalesce(case when s.status='grace' then s.grace_end end,s.period_end) then return false;end if;
  if limits ? 'ai_responses' and (select count(*) from public.whatsapp_usage where restaurant_id=j.restaurant_id and created_at>=s.period_start and created_at<s.period_end)>=(limits->>'ai_responses')::bigint then return false;end if;
 end if;
 return public.whatsapp_reserve_before_saas(p_job,p_lease,p_model,p_reserved_usd);
end $$;
revoke execute on function public.whatsapp_reserve_before_saas(uuid,uuid,text,numeric),public.whatsapp_reserve_ai(uuid,uuid,text,numeric) from public,anon,authenticated;
grant execute on function public.whatsapp_reserve_ai(uuid,uuid,text,numeric) to service_role;
commit;

