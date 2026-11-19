begin;
-- Managed assignments deliberately grant/withdraw access; they never claim a payment.
create function public.saas_sync_access() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.restaurants set start_date=new.period_start,
 end_date=case when new.status in ('active','trial','suspended') then new.period_end when new.status='grace' then coalesce(new.grace_end,new.period_end) else least(new.period_end,now()) end,
 status=case when new.status='suspended' then 'suspended' when tg_op='INSERT' or new.status is distinct from old.status then 'active' else status end,
 grace_period_days=0,updated_at=now() where id=new.restaurant_id;
 return new;
end $$;
create trigger saas_access_sync after insert or update on public.saas_subscriptions for each row execute function public.saas_sync_access();
alter table public.saas_payments add column gateway_reference text unique references public.subscription_payments(reference_id);
create table public.saas_recurring_expenses(
 id uuid primary key default gen_random_uuid(),restaurant_id uuid references public.restaurants,
 category text not null check(length(category) between 1 and 100),vendor text not null check(length(vendor) between 1 and 150),
 description text not null check(length(description) between 1 and 1000),amount numeric(18,2) not null check(amount>0),
 currency text not null check(currency in ('IQD','USD')),cost_class text not null check(cost_class in ('direct','operating','tax')),
 starts_on date not null,ends_on date,frequency text not null check(frequency in ('month','year')),
 evidence_reference text not null unique check(length(evidence_reference) between 3 and 200),
 active boolean not null default true,created_at timestamptz not null default now(),check(ends_on is null or ends_on>=starts_on));
create table public.saas_expense_settlements(
 id uuid primary key default gen_random_uuid(),expense_id uuid not null references public.saas_expenses,
 amount numeric(18,2) not null check(amount<>0),refund_of uuid references public.saas_expense_settlements,paid_at timestamptz not null default now(),
 reference text not null unique check(length(reference) between 1 and 200),method text not null check(length(method) between 1 and 100),check((amount<0)=(refund_of is not null)));
create index saas_settlements_expense on public.saas_expense_settlements(expense_id,paid_at);
create trigger audit_change after insert or update on public.saas_recurring_expenses for each row execute function public.saas_audit_change();
create trigger audit_change after insert on public.saas_expense_settlements for each row execute function public.saas_audit_change();
create trigger immutable before update or delete on public.saas_expense_settlements for each row execute function public.saas_immutable();
do $$ declare t text;begin
 foreach t in array array['saas_recurring_expenses','saas_expense_settlements'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy platform_admin_read on public.%I for select to authenticated using ((select public.is_system_admin()))',t);
 end loop;
end $$;
-- Serves preview and materialization from identical due-date arithmetic. Anchor
-- each occurrence to the original day so Jan 31 -> Feb 28 -> Mar 31.
create function public.saas_recurring_due(p_through date) returns table(rule_id uuid,due_date date,reference text) language sql stable set search_path='' as $$
 select r.id,d.due_on::date,'recurring:'||r.id||':'||d.due_on::date
 from public.saas_recurring_expenses r cross join lateral
 (select (r.starts_on + make_interval(months=>n*case when r.frequency='year' then 12 else 1 end))::date as due_on
 from generate_series(0,least(1200,greatest(0,((extract(year from p_through)-extract(year from r.starts_on))*12+extract(month from p_through)-extract(month from r.starts_on)))::int)) n) d
 where r.active and d.due_on<=p_through and d.due_on<=coalesce(r.ends_on,p_through)
 and not exists(select 1 from public.saas_expenses e where e.source_reference='recurring:'||r.id||':'||d.due_on::date)
$$;
create function public.saas_materialize_expenses(p_through date) returns integer language plpgsql set search_path='' as $$
declare d record;r public.saas_recurring_expenses;rate numeric;total integer:=0;
begin
 if p_through>(now() at time zone 'Asia/Baghdad')::date then raise exception 'future_expense_not_accrued';end if;
 perform pg_advisory_xact_lock(18276455);
 for d in select * from public.saas_recurring_due(p_through) limit 1001 loop
  if total>=1000 then raise exception 'too_many_due_expenses_use_smaller_period';end if;
  select * into strict r from public.saas_recurring_expenses where id=d.rule_id for share;
  select iqd_per_usd into rate from public.saas_fx_rates where effective_date<=d.due_date order by effective_date desc limit 1;
  if r.currency='USD' and rate is null then raise exception 'exchange_rate_required_for_%',d.due_date;end if;
  insert into public.saas_expenses(restaurant_id,category,vendor,description,amount,currency,fx,expense_date,cost_class,source_reference,notes)
  values(r.restaurant_id,r.category,r.vendor,r.description,r.amount,r.currency,case when r.currency='IQD' then 1 else rate end,d.due_date,r.cost_class,d.reference,'Contract accrual: '||r.evidence_reference) on conflict(source_reference) do nothing;
  total:=total+1;
 end loop;return total;
end $$;
alter function public.saas_admin_command(text,jsonb) rename to saas_admin_command_foundation;
create function public.saas_admin_command(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;e public.saas_expenses;s public.saas_expense_settlements;original_settlement public.saas_expense_settlements;p public.subscription_payments;i public.saas_invoices;existing public.saas_payments;amount numeric;
begin
 if not public.is_system_admin() then raise exception 'admin_required' using errcode='42501';end if;
 if p_action='recurring' then
  insert into public.saas_recurring_expenses(restaurant_id,category,vendor,description,amount,currency,cost_class,starts_on,ends_on,frequency,evidence_reference)
  values((p_data->>'restaurant_id')::uuid,p_data->>'category',p_data->>'vendor',p_data->>'description',(p_data->>'amount')::numeric,p_data->>'currency',p_data->>'cost_class',(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,p_data->>'frequency',p_data->>'evidence_reference') returning to_jsonb(saas_recurring_expenses.*) into r;
 elsif p_action='pause_recurring' then
  update public.saas_recurring_expenses set active=(p_data->>'active')::boolean where id=(p_data->>'id')::uuid returning to_jsonb(saas_recurring_expenses.*) into r;
  if r is null then raise exception 'recurring_rule_not_found';end if;
 elsif p_action='preview_recurring' then
  select coalesce(jsonb_agg(d),'[]') into r from(select * from public.saas_recurring_due((p_data->>'through')::date) order by due_date,rule_id limit 1000)d;
 elsif p_action='post_recurring' then
  return jsonb_build_object('posted',public.saas_materialize_expenses((p_data->>'through')::date));
 elsif p_action='expense_payment' then
  select * into strict e from public.saas_expenses where id=(p_data->>'expense_id')::uuid for update;
  select * into s from public.saas_expense_settlements where reference=p_data->>'reference';
  if found then
   if s.expense_id=e.id and s.amount=(p_data->>'amount')::numeric and s.refund_of is not distinct from (p_data->>'refund_of')::uuid then return to_jsonb(s);end if;raise exception 'settlement_reference_conflict';
  end if;
  amount:=(p_data->>'amount')::numeric;
  if p_data->>'refund_of' is not null then
   select * into strict original_settlement from public.saas_expense_settlements original where original.id=(p_data->>'refund_of')::uuid and original.expense_id=e.id and original.amount>0 for update;
   if amount>=0 or -amount>original_settlement.amount+coalesce((select sum(x.amount) from public.saas_expense_settlements x where x.refund_of=original_settlement.id),0) or coalesce((p_data->>'paid_at')::timestamptz,now())<original_settlement.paid_at then raise exception 'invalid_expense_refund';end if;
  elsif e.amount<=0 or e.paid_date is not null or amount<=0 or amount>e.amount+coalesce((select sum(c.amount) from public.saas_expenses c where c.correction_of=e.id and c.amount<0),0)-coalesce((select sum(x.amount) from public.saas_expense_settlements x where expense_id=e.id),0) then raise exception 'invalid_expense_payment';end if;
  if (p_data->>'paid_at')::timestamptz>now() then raise exception 'future_payment_not_collected';end if;
  insert into public.saas_expense_settlements(expense_id,amount,refund_of,paid_at,reference,method) values(e.id,amount,(p_data->>'refund_of')::uuid,coalesce((p_data->>'paid_at')::timestamptz,now()),p_data->>'reference',p_data->>'method') returning to_jsonb(saas_expense_settlements.*) into r;
 elsif p_action='reconcile_wayl' then
  select * into strict p from public.subscription_payments where reference_id=p_data->>'gateway_reference' and status='paid' and environment='live' for update;
  select * into strict i from public.saas_invoices where id=(p_data->>'invoice_id')::uuid and restaurant_id=p.restaurant_id for update;
  select * into existing from public.saas_payments where gateway_reference=p.reference_id;
  if found then if existing.invoice_id=i.id then return to_jsonb(existing);end if;raise exception 'gateway_already_allocated';end if;
  if i.currency<>'IQD' or p.amount_iqd>i.total-coalesce((select sum(x.amount) from public.saas_payments x where invoice_id=i.id),0) then raise exception 'gateway_allocation_mismatch';end if;
  insert into public.saas_payments(invoice_id,amount,paid_at,method,reference,gateway_reference)
  values(i.id,p.amount_iqd,p.paid_at,'WAYL','wayl:'||p.reference_id,p.reference_id) returning to_jsonb(saas_payments.*) into r;
 else
  if p_action='payment' and (lower(p_data->>'method')='wayl' or p_data->>'reference' like 'wayl:%') then raise exception 'use_gateway_reconciliation';end if;
  return public.saas_admin_command_foundation(p_action,p_data);
 end if;return r;
end $$;
alter function public.saas_admin_list(text,int) rename to saas_admin_list_foundation;
create function public.saas_admin_list(p_resource text,p_offset int default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 if not public.is_system_admin() then raise exception 'admin_required' using errcode='42501';end if;
 if p_offset<0 then raise exception 'invalid_offset';end if;
 if p_resource='recurring' then select coalesce(jsonb_agg(t),'[]') into r from(select * from public.saas_recurring_expenses order by starts_on desc,id limit 50 offset p_offset)t;
 elsif p_resource='expense_payments' then select coalesce(jsonb_agg(t),'[]') into r from(select * from public.saas_expense_settlements order by paid_at desc,id limit 50 offset p_offset)t;
 elsif p_resource='gateway_unallocated' then select coalesce(jsonb_agg(t),'[]') into r from(select p.reference_id,p.restaurant_id,p.amount_iqd,p.paid_at from public.subscription_payments p where status='paid' and environment='live' and not exists(select 1 from public.saas_payments s where s.gateway_reference=p.reference_id) order by paid_at desc,reference_id limit 50 offset p_offset)t;
 else return public.saas_admin_list_foundation(p_resource,p_offset);end if;return r;
end $$;
alter function public.saas_admin_report(date,date,uuid,int) rename to saas_admin_report_foundation;
create function public.saas_admin_report(p_start date,p_end date,p_restaurant uuid default null,p_offset int default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;settled numeric;linked numeric;invoice_cash numeric;begins timestamptz;ends timestamptz;
begin
 if not public.is_system_admin() then raise exception 'admin_required' using errcode='42501';end if;
 r:=public.saas_admin_report_foundation(p_start,p_end,p_restaurant,p_offset);
 begins:=p_start::timestamp at time zone 'Asia/Baghdad';ends:=(p_end+1)::timestamp at time zone 'Asia/Baghdad';
 select coalesce(sum(s.amount*e.fx),0) into settled from public.saas_expense_settlements s join public.saas_expenses e on e.id=s.expense_id where s.paid_at>=begins and s.paid_at<ends and (p_restaurant is null or e.restaurant_id=p_restaurant);
 select coalesce(sum(s.amount*i.fx),0) into linked from public.saas_payments s join public.saas_invoices i on i.id=s.invoice_id where gateway_reference is not null and s.paid_at>=begins and s.paid_at<ends and (p_restaurant is null or i.restaurant_id=p_restaurant);
 select coalesce(sum(p.amount*i.fx),0) into invoice_cash from public.saas_payments p join public.saas_invoices i on i.id=p.invoice_id where p.paid_at>=begins and p.paid_at<ends and (p_restaurant is null or i.restaurant_id=p_restaurant);
 return r||jsonb_build_object('manual_collected',invoice_cash,'cash_expenses',(r->>'cash_expenses')::numeric+settled,'invoice_collected',invoice_cash,'gateway_collected',greatest(0,(r->>'gateway_collected')::numeric-linked),'total_collected',invoice_cash+(r->>'gateway_collected')::numeric-linked);
end $$;
revoke execute on function public.saas_sync_access(),public.saas_recurring_due(date),public.saas_materialize_expenses(date),public.saas_admin_command_foundation(text,jsonb),public.saas_admin_list_foundation(text,int),public.saas_admin_report_foundation(date,date,uuid,int) from public,anon,authenticated;
grant execute on function public.saas_materialize_expenses(date) to service_role;
revoke execute on function public.saas_admin_command(text,jsonb),public.saas_admin_list(text,int),public.saas_admin_report(date,date,uuid,int) from public,anon;
grant execute on function public.saas_admin_command(text,jsonb),public.saas_admin_list(text,int),public.saas_admin_report(date,date,uuid,int) to authenticated;

alter table public.subscription_payments add column saas_snapshot jsonb;
create function public.saas_gateway_quote(p_restaurant uuid) returns jsonb language plpgsql set search_path='' as $$
declare s public.saas_subscriptions;
begin
 select * into s from public.saas_subscriptions where restaurant_id=p_restaurant;
 if not found then return null;end if;
 if s.status in ('cancelled','suspended') or s.currency<>'IQD' or s.price<=0 or s.price<>trunc(s.price) or s.price>1000000000 then raise exception 'managed_manual_payment_required';end if;
 return jsonb_build_object('amount',s.price,'duration','month','snapshot',jsonb_build_object('plan_id',s.plan_id,'price',s.price,'currency',s.currency));
end $$;
create function public.saas_validate_gateway_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare quote jsonb;
begin
 quote:=public.saas_gateway_quote(new.restaurant_id);
 if quote is not null and (new.saas_snapshot is distinct from quote->'snapshot' or new.amount_iqd<>(quote->>'amount')::numeric or new.duration<>'month') then raise exception 'checkout_terms_changed';end if;
 return new;
end $$;
create trigger validate_saas_checkout before insert on public.subscription_payments for each row execute function public.saas_validate_gateway_snapshot();
alter function public.apply_paid_subscription(text) rename to apply_paid_subscription_legacy;
create function public.apply_paid_subscription(p_reference_id text) returns boolean language plpgsql security definer set search_path='' as $$
declare p public.subscription_payments;s public.saas_subscriptions;r public.restaurants;after_r public.restaurants;i public.saas_invoices;begins timestamptz;applied boolean;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required';end if;
 select * into strict p from public.subscription_payments where reference_id=p_reference_id for update;
 if p.status='paid' then return false;end if;
 select * into s from public.saas_subscriptions where restaurant_id=p.restaurant_id for update;
 select * into strict r from public.restaurants where id=p.restaurant_id for update;
 begins:=greatest(now(),r.end_date);
 applied:=public.apply_paid_subscription_legacy(p_reference_id);
 if s.restaurant_id is null or p.environment<>'live' then return applied;end if;
 -- A live verified payment grants exactly the snapshotted monthly agreement.
 -- Changed or cancelled agreements need staff reconciliation, never guessed fees.
 if s.status in ('cancelled','suspended') or p.saas_snapshot is distinct from jsonb_build_object('plan_id',s.plan_id,'price',s.price,'currency',s.currency) or s.currency<>'IQD' or p.amount_iqd<>s.price or p.duration<>'month' then
  update public.restaurants set status=r.status,end_date=r.end_date,start_date=r.start_date where id=r.id;
  insert into public.saas_audit(action,record_id,after_data) values('gateway_reconciliation_required',p.reference_id,jsonb_build_object('restaurant_id',p.restaurant_id));
  return applied;
 end if;
 select * into strict after_r from public.restaurants where id=r.id;
 if exists(select 1 from public.saas_invoices where restaurant_id=r.id and tstzrange(period_start,period_end,'[)') && tstzrange(begins,after_r.end_date,'[)')) then
  update public.restaurants set status=r.status,end_date=r.end_date,start_date=r.start_date where id=r.id;
  insert into public.saas_audit(action,record_id) values('gateway_reconciliation_required',p.reference_id);return applied;
 end if;
 update public.saas_subscriptions set period_start=begins,period_end=after_r.end_date,status='active',grace_end=null where restaurant_id=r.id;
 -- The lifecycle trigger preserves an independent administrator suspension.
 update public.restaurants set status=r.status where id=r.id;
 insert into public.saas_invoices(restaurant_id,subscription_plan,period_start,period_end,due_at,currency,fx,plan_amount,notes)
 values(r.id,s.plan_id,begins,after_r.end_date,now(),'IQD',1,p.amount_iqd,'Verified WAYL renewal: '||p.reference_id) returning * into i;
 insert into public.saas_payments(invoice_id,amount,paid_at,method,reference,gateway_reference) values(i.id,p.amount_iqd,now(),'WAYL','wayl:'||p.reference_id,p.reference_id);
 return applied;
end $$;
revoke execute on function public.saas_gateway_quote(uuid),public.saas_validate_gateway_snapshot(),public.apply_paid_subscription_legacy(text),public.apply_paid_subscription(text) from public,anon,authenticated;
revoke execute on function public.apply_paid_subscription_legacy(text) from service_role;
grant execute on function public.saas_gateway_quote(uuid),public.apply_paid_subscription(text) to service_role;
-- Install a daily job only where the existing Supabase Cron extension exists.
-- No new extension or external request is introduced. Re-running schedule by
-- name updates the existing job rather than adding duplicate executions.
do $schedule$
begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  execute $sql$select cron.schedule('ordova-saas-recurring','23 21 * * *',
   'select public.saas_materialize_expenses((now() at time zone ''Asia/Baghdad'')::date)')$sql$;
 end if;
end $schedule$;
commit;

