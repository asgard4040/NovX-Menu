begin;

alter table public.restaurants add column owner_setup_completed_at timestamptz;
update public.restaurants set owner_setup_completed_at = now();

create function public.complete_owner_setup(p_restaurant uuid, p_table_count integer, p_theme text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare venue public.restaurants;
begin
  if auth.uid() is null or not public.has_restaurant_role(p_restaurant, array['owner']::public.member_role[]) then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if p_table_count is null or p_table_count not between 0 and 500 or p_theme is null or p_theme not in (
    'ordova','italian-luxury','urban-modern','pure-minimal','fast-bite','heritage','cafe','botanical','midnight','coastal'
  ) then raise exception 'invalid_owner_setup'; end if;

  select * into venue from public.restaurants where id = p_restaurant for update;
  if not coalesce(public.subscription_active(venue), false) then raise exception 'subscription_inactive'; end if;
  if venue.owner_setup_completed_at is null then
    update public.restaurants set table_count = p_table_count, theme_id = p_theme, theme_colors = '{}',
      owner_setup_completed_at = now(), updated_at = now()
    where id = p_restaurant returning * into venue;
  end if;
  return jsonb_build_object('themeId', venue.theme_id, 'themeColors', venue.theme_colors, 'tableCount', venue.table_count);
end;
$$;
revoke execute on function public.complete_owner_setup(uuid,integer,text) from public, anon;
grant execute on function public.complete_owner_setup(uuid,integer,text) to authenticated;

create or replace function public.whatsapp_begin_signup(p_restaurant uuid, p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  perform 1 from public.restaurants where id = p_restaurant for update;
  if not found or not exists (
    select 1 from auth.users where id = p_user and raw_app_meta_data->>'system_role' = 'admin'
  ) then return null; end if;
  if (select count(*) from public.whatsapp_signup where restaurant_id = p_restaurant
    and expires_at > now() - interval '5 minutes') >= 8 then return null; end if;
  insert into public.whatsapp_signup(restaurant_id,user_id) values (p_restaurant,p_user) returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.whatsapp_reserve_account(
  p_restaurant uuid,p_signup uuid,p_phone text,p_waba text,p_display text,p_coexistence boolean
) returns text language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.restaurants where id = p_restaurant for update;
  if not found or not public.restaurant_subscription_active(p_restaurant) or not exists (
    select 1 from public.whatsapp_signup s join auth.users u on u.id = s.user_id
    where s.id = p_signup and s.restaurant_id = p_restaurant and s.expires_at > now()
      and s.token_ciphertext is not null and u.raw_app_meta_data->>'system_role' = 'admin'
  ) then return 'signup_expired'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ordova:whatsapp:waba:' || p_waba, 0));
  if exists (select 1 from public.whatsapp_accounts where (restaurant_id = p_restaurant or waba_id = p_waba)
    and status in ('connecting','disconnecting') and operation_at > now() - interval '3 minutes')
    then return 'account_operation_unavailable'; end if;
  if exists (select 1 from public.whatsapp_accounts where restaurant_id = p_restaurant
    and phone_id <> p_phone and status <> 'disconnected') then return 'disconnect_current_number'; end if;
  insert into public.whatsapp_accounts(phone_id,restaurant_id,waba_id,display_phone,status,coexistence,onboarding_id)
  values(p_phone,p_restaurant,p_waba,p_display,'connecting',p_coexistence,p_signup)
  on conflict(restaurant_id,phone_id) do update set waba_id=excluded.waba_id,display_phone=excluded.display_phone,status='connecting',
    coexistence=excluded.coexistence,onboarding_id=excluded.onboarding_id,operation_at=now(),last_error=null
  where whatsapp_accounts.waba_id=p_waba or whatsapp_accounts.status='disconnected';
  return case when found then 'reserved' else 'account_in_use' end;
exception when unique_violation then return 'account_in_use';
end;
$$;
revoke execute on function public.whatsapp_begin_signup(uuid,uuid),
  public.whatsapp_reserve_account(uuid,uuid,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_begin_signup(uuid,uuid),
  public.whatsapp_reserve_account(uuid,uuid,text,text,text,boolean) to service_role;

create table public.platform_whatsapp_sender (
  id boolean primary key default true check (id),
  app_id uuid not null unique,
  app_name text not null,
  source text not null,
  key_ciphertext text not null,
  callback_ciphertext text not null,
  templates jsonb not null default '{}',
  connected_at timestamptz not null default now()
);
create table public.platform_whatsapp_consents (
  restaurant_id uuid not null references public.restaurants on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  phone text not null check (phone ~ '^[1-9][0-9]{6,14}$'),
  granted_at timestamptz not null default now(),
  granted_by uuid,
  primary key (restaurant_id, user_id)
);
create index platform_whatsapp_consent_phone on public.platform_whatsapp_consents(phone);

create table public.platform_whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants on delete cascade,
  user_id uuid,
  kind text not null check (kind in ('invite','renewed','expired','manual')),
  event_key text not null unique,
  period_end timestamptz,
  template_id uuid,
  phone_last_four text check (phone_last_four ~ '^[0-9]{4}$'),
  app_id uuid,
  provider_id text,
  state text not null default 'queued' check (state in (
    'queued','sending','submitted','sent','delivered','read','failed','skipped','uncertain'
  )),
  reason text,
  attempts integer not null default 0,
  run_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index platform_whatsapp_outbox_due on public.platform_whatsapp_outbox(run_at) where state in ('queued','sending');
create unique index platform_whatsapp_outbox_provider on public.platform_whatsapp_outbox(app_id,provider_id) where provider_id is not null;
create index platform_whatsapp_outbox_recent on public.platform_whatsapp_outbox(created_at desc);
create table public.platform_whatsapp_delivery_events (
  app_id uuid not null,
  provider_id text not null,
  state text not null check (state in ('sent','delivered','read','failed')),
  received_at timestamptz not null default now(),
  primary key (app_id, provider_id)
);

alter table public.platform_whatsapp_sender enable row level security;
alter table public.platform_whatsapp_consents enable row level security;
alter table public.platform_whatsapp_outbox enable row level security;
alter table public.platform_whatsapp_delivery_events enable row level security;
revoke all on public.platform_whatsapp_sender, public.platform_whatsapp_consents,
  public.platform_whatsapp_outbox, public.platform_whatsapp_delivery_events from public, anon, authenticated;
grant select, insert, update, delete on public.platform_whatsapp_sender, public.platform_whatsapp_consents,
  public.platform_whatsapp_outbox, public.platform_whatsapp_delivery_events to service_role;

-- One callback application and sender phone identify exactly one transport.
create function ordova_private.platform_whatsapp_check_number()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'platform_whatsapp_sender' then
    perform pg_catalog.pg_advisory_xact_lock(111617, 5);
    if exists (select 1 from public.whatsapp_accounts where status <> 'disconnected'
      and (gupshup_app_id = new.app_id::text or gupshup_source = new.source
        or regexp_replace(coalesce(display_phone, ''), '[^0-9]', '', 'g') = new.source)) then
      raise exception 'platform_sender_already_in_use';
    end if;
  elsif new.status <> 'disconnected' then
    perform pg_catalog.pg_advisory_xact_lock(111617, 5);
    if exists (select 1 from public.platform_whatsapp_sender where app_id::text = new.gupshup_app_id
      or source = new.gupshup_source or source = regexp_replace(coalesce(new.display_phone, ''), '[^0-9]', '', 'g')) then
      raise exception 'platform_sender_already_in_use';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function ordova_private.platform_whatsapp_check_number() from public;
create trigger platform_sender_unique before insert or update of app_id, source on public.platform_whatsapp_sender
  for each row execute function ordova_private.platform_whatsapp_check_number();
create trigger platform_number_reserved before insert or update of gupshup_app_id, gupshup_source, display_phone, status on public.whatsapp_accounts
  for each row execute function ordova_private.platform_whatsapp_check_number();

-- The staff phone is operational data and can be edited by restaurant staff.
-- Drop the recorded permission whenever the underlying phone changes.
create function ordova_private.platform_whatsapp_clear_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'restaurants' then
    delete from public.platform_whatsapp_consents c using public.restaurant_members m
    where c.restaurant_id = new.id and c.restaurant_id = m.restaurant_id and c.user_id = m.user_id and m.role = 'owner';
  else
    delete from public.platform_whatsapp_consents where restaurant_id = old.restaurant_id and user_id = old.auth_user_id;
  end if;
  return new;
end;
$$;
revoke execute on function ordova_private.platform_whatsapp_clear_consent() from public;
create trigger platform_whatsapp_owner_phone_changed after update of manager_phone on public.restaurants
  for each row when (old.manager_phone is distinct from new.manager_phone) execute function ordova_private.platform_whatsapp_clear_consent();
create trigger platform_whatsapp_staff_phone_changed after update of phone on public.staff
  for each row when (old.phone is distinct from new.phone) execute function ordova_private.platform_whatsapp_clear_consent();

create view ordova_private.platform_whatsapp_periods as
select r.id as restaurant_id,
  coalesce(s.period_end, r.end_date) as period_end,
  case when s.restaurant_id is null then r.end_date + make_interval(days => r.grace_period_days)
    else greatest(s.period_end, s.grace_end) end as expires_at,
  case when r.status <> 'active' then r.status::text else coalesce(s.status, r.status::text) end as status
from public.restaurants r left join public.saas_subscriptions s on r.id = s.restaurant_id;

create function ordova_private.platform_whatsapp_queue_renewal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare rid uuid; period timestamptz;
begin
  if tg_table_name = 'restaurants' then
    if new.status <> 'active' or new.end_date <= old.end_date or exists (
      select 1 from public.saas_subscriptions where restaurant_id = new.id
    ) then return new; end if;
    rid := new.id; period := new.end_date;
  else
    if new.status <> 'active' or new.period_end <= old.period_end then return new; end if;
    rid := new.restaurant_id; period := new.period_end;
  end if;
  insert into public.platform_whatsapp_outbox(restaurant_id, user_id, kind, event_key, period_end)
  select rid, m.user_id, 'renewed', 'renewed:' || rid || ':' || extract(epoch from period), period
  from public.restaurant_members m join public.platform_whatsapp_consents c using(restaurant_id, user_id)
  where m.restaurant_id = rid and m.role = 'owner' and m.active
  on conflict(event_key) do nothing;
  return new;
end;
$$;
revoke execute on function ordova_private.platform_whatsapp_queue_renewal() from public;
create trigger platform_whatsapp_legacy_renewal after update of end_date on public.restaurants
  for each row execute function ordova_private.platform_whatsapp_queue_renewal();
create trigger platform_whatsapp_managed_renewal after update of period_end on public.saas_subscriptions
  for each row execute function ordova_private.platform_whatsapp_queue_renewal();

create function public.platform_whatsapp_claim()
returns setof public.platform_whatsapp_outbox language plpgsql set search_path = '' as $$
begin
  delete from public.platform_whatsapp_delivery_events where received_at < now() - interval '14 days';
  insert into public.platform_whatsapp_outbox(restaurant_id, user_id, kind, event_key, period_end)
  select p.restaurant_id, c.user_id, 'expired',
    'expired:' || p.restaurant_id || ':' || extract(epoch from p.period_end), p.period_end
  from ordova_private.platform_whatsapp_periods p
  join public.restaurant_members m on m.restaurant_id = p.restaurant_id and m.role = 'owner' and m.active
  join public.platform_whatsapp_consents c on c.restaurant_id = m.restaurant_id and c.user_id = m.user_id
  where p.status in ('active','trial','grace','past_due','expired') and p.expires_at <= now()
    and p.expires_at >= c.granted_at
  on conflict(event_key) do nothing;
  update public.platform_whatsapp_outbox set state = 'uncertain', reason = 'worker_interrupted', updated_at = now()
    where state = 'sending' and run_at <= now();
  return query with due as (
    select id from public.platform_whatsapp_outbox where state = 'queued' and run_at <= now()
    order by run_at,id limit 4 for update skip locked
  )
  update public.platform_whatsapp_outbox t set state = 'sending', attempts = t.attempts + 1,
    run_at = now() + interval '2 minutes', updated_at = now()
    from due where due.id = t.id returning t.*;
end;
$$;

create function public.platform_whatsapp_period_date(p_restaurant uuid, p_period timestamptz, p_kind text)
returns timestamptz language sql stable set search_path = '' as $$
  select case when p_kind = 'expired' then expires_at else period_end end
  from ordova_private.platform_whatsapp_periods where restaurant_id = p_restaurant and period_end = p_period and (
    (p_kind = 'expired' and status in ('active','trial','grace','past_due','expired') and expires_at <= now())
    or (p_kind = 'renewed' and status in ('active','trial','grace') and expires_at > now())
  );
$$;

create function ordova_private.platform_whatsapp_delivery_rank(p_state text)
returns int language sql immutable set search_path = '' as $$
  select case p_state when 'sent' then 1 when 'failed' then 2 when 'delivered' then 3 when 'read' then 4 else 0 end;
$$;
revoke execute on function ordova_private.platform_whatsapp_delivery_rank(text) from public;
grant usage on schema ordova_private to service_role;
grant select on ordova_private.platform_whatsapp_periods to service_role;
grant execute on function ordova_private.platform_whatsapp_delivery_rank(text) to service_role;

create function public.platform_whatsapp_delivery(p_app uuid, p_provider text, p_state text)
returns void language plpgsql set search_path = '' as $$
begin
  insert into public.platform_whatsapp_delivery_events(app_id,provider_id,state) values (p_app,p_provider,p_state)
  on conflict(app_id,provider_id) do update set state=excluded.state,received_at=now()
  where ordova_private.platform_whatsapp_delivery_rank(excluded.state) >
    ordova_private.platform_whatsapp_delivery_rank(platform_whatsapp_delivery_events.state);

  update public.platform_whatsapp_outbox t set state=e.state, reason=case when e.state='failed' then 'provider_failed' end, updated_at=now()
    from public.platform_whatsapp_delivery_events e where e.app_id=p_app and e.provider_id=p_provider
    and t.app_id=e.app_id and t.provider_id=e.provider_id
    and ordova_private.platform_whatsapp_delivery_rank(e.state) > ordova_private.platform_whatsapp_delivery_rank(t.state);
end;
$$;
create function public.platform_whatsapp_submitted(p_job uuid, p_app uuid, p_provider text)
returns void language plpgsql set search_path = '' as $$
begin
  update public.platform_whatsapp_outbox set state='submitted', app_id=p_app, provider_id=p_provider, reason=null, updated_at=now()
    where id=p_job and state in ('sending','uncertain');
  update public.platform_whatsapp_outbox t set state=e.state, reason=case when e.state='failed' then 'provider_failed' end, updated_at=now()
    from public.platform_whatsapp_delivery_events e where t.id=p_job and e.app_id=p_app and e.provider_id=p_provider
    and t.app_id=e.app_id and t.provider_id=e.provider_id
    and ordova_private.platform_whatsapp_delivery_rank(e.state) > ordova_private.platform_whatsapp_delivery_rank(t.state);
end;
$$;

revoke execute on function public.platform_whatsapp_claim(), public.platform_whatsapp_period_date(uuid,timestamptz,text),
  public.platform_whatsapp_delivery(uuid,text,text), public.platform_whatsapp_submitted(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.platform_whatsapp_claim(), public.platform_whatsapp_period_date(uuid,timestamptz,text),
  public.platform_whatsapp_delivery(uuid,text,text), public.platform_whatsapp_submitted(uuid,uuid,text) to service_role;

create function public.platform_whatsapp_dispatch() returns void
language plpgsql set search_path = '' as $$
declare worker_url text; worker_secret text;
begin
  select decrypted_secret into worker_url from vault.decrypted_secrets where name='ordova_whatsapp_worker_url';
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name='ordova_whatsapp_worker_secret';
  if worker_url is null or worker_secret is null or worker_url !~ '/api/whatsapp/worker/?$' then return; end if;
  if not exists(select 1 from public.platform_whatsapp_outbox where state in ('queued','sending') and run_at <= now())
    and not exists(
      select 1 from ordova_private.platform_whatsapp_periods p
      join public.restaurant_members m on m.restaurant_id=p.restaurant_id and m.role='owner' and m.active
      join public.platform_whatsapp_consents c on c.restaurant_id=m.restaurant_id and c.user_id=m.user_id
      where p.status in ('active','trial','grace','past_due','expired') and p.expires_at <= now()
        and p.expires_at >= c.granted_at
        and not exists(select 1 from public.platform_whatsapp_outbox o
          where o.event_key='expired:' || p.restaurant_id || ':' || extract(epoch from p.period_end))
    ) then return; end if;
  perform net.http_post(url := regexp_replace(worker_url,'/worker/?$','/platform/worker'),
    headers := jsonb_build_object('Authorization','Bearer '||worker_secret,'Content-Type','application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 55000);
end;
$$;
revoke execute on function public.platform_whatsapp_dispatch() from public, anon, authenticated, service_role;
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    execute $schedule$select cron.schedule('ordova-platform-whatsapp','10 seconds','select public.platform_whatsapp_dispatch()')$schedule$;
  end if;
end;
$$;

commit;
