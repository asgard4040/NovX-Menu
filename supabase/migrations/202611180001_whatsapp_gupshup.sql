begin;

alter table public.whatsapp_accounts
  add column provider text not null default 'meta' check (provider in ('meta','gupshup')),
  add column gupshup_app_id text,
  add column gupshup_app_name text,
  add column gupshup_source text,
  add column webhook_secret_ciphertext text;

-- Gupshup connections use explicitly namespaced internal routing keys. These
-- are not Meta phone_number_id or WABA IDs. Existing foreign keys stay intact.
alter table public.whatsapp_accounts drop constraint whatsapp_accounts_phone_id_check;
alter table public.whatsapp_accounts drop constraint whatsapp_accounts_waba_id_check;
alter table public.whatsapp_accounts add constraint whatsapp_provider_identity check (
  (provider='meta' and phone_id ~ '^[0-9]{5,32}$' and waba_id ~ '^[0-9]{5,32}$') or
  (provider='gupshup' and gupshup_app_id is not null and gupshup_app_name is not null and gupshup_source is not null
    and gupshup_app_id ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    and phone_id='gupshup:'||gupshup_app_id and waba_id=phone_id
    and gupshup_app_name ~ '^[A-Za-z0-9_-]{1,128}$' and gupshup_source ~ '^[1-9][0-9]{6,14}$'
    and meta_app_id is null and app_secret_ciphertext is null)
);
create unique index whatsapp_gupshup_app on public.whatsapp_accounts(gupshup_app_id)
  where provider='gupshup' and status<>'disconnected';
create unique index whatsapp_gupshup_source on public.whatsapp_accounts(gupshup_source)
  where provider='gupshup' and status<>'disconnected';

create function public.whatsapp_save_gupshup(p_restaurant uuid,p_app text,p_name text,p_source text,p_token text,p_webhook text)
returns text language plpgsql set search_path = '' as $$
begin
  perform 1 from public.restaurants where id=p_restaurant for update;
  if not found or not public.restaurant_subscription_active(p_restaurant) then return 'subscription_inactive'; end if;
  if exists(select 1 from public.whatsapp_accounts where restaurant_id=p_restaurant
    and status in ('connecting','disconnecting')) then return 'account_operation_unavailable'; end if;
  if exists(select 1 from public.whatsapp_accounts where restaurant_id=p_restaurant and status<>'disconnected'
    and (provider<>'gupshup' or gupshup_app_id<>p_app or gupshup_source<>p_source or gupshup_app_name<>p_name)) then
    return 'disconnect_current_number';
  end if;
  insert into public.whatsapp_accounts as existing
    (restaurant_id,phone_id,waba_id,display_phone,provider,gupshup_app_id,gupshup_app_name,gupshup_source,
      token_ciphertext,webhook_secret_ciphertext,status,subscribed,verified_at)
  values(p_restaurant,'gupshup:'||p_app,'gupshup:'||p_app,'+'||p_source,'gupshup',p_app,p_name,p_source,
    p_token,p_webhook,'connected',false,now())
  on conflict(restaurant_id,phone_id) do update set
    gupshup_app_name=p_name,gupshup_source=p_source,display_phone='+'||p_source,
    token_ciphertext=p_token,webhook_secret_ciphertext=p_webhook,token_expires_at=null,data_access_expires_at=null,
    status='connected',subscribed=false,verified_at=now(),last_error=null,onboarding_id=null,last_webhook_at=null,
    operation_at=case when existing.status='connected' then existing.operation_at else now() end;
  return 'connected';
exception when unique_violation then return 'account_in_use';
end $$;

create function public.whatsapp_ingest_gupshup(p_restaurant uuid,p_phone text,p_secret text,p_events jsonb)
returns integer language plpgsql set search_path = '' as $$
begin
  perform 1 from public.whatsapp_accounts where restaurant_id=p_restaurant and phone_id=p_phone
    and provider='gupshup' and status='connected' and webhook_secret_ciphertext=p_secret for update;
  if not found then return -1; end if;
  if exists(select 1 from jsonb_array_elements(p_events) e where e->>'phone'<>p_phone
    or e->>'waba'<>p_phone or e->>'kind' not in ('text','button','unsupported','status')) then return -1; end if;
  update public.whatsapp_accounts set subscribed=true,last_webhook_at=now()
    where restaurant_id=p_restaurant and phone_id=p_phone;
  return public.whatsapp_ingest(p_events);
end $$;

create or replace function public.whatsapp_ingest_verified(p_events jsonb,p_restaurant uuid,p_secret text)
returns integer language plpgsql set search_path = '' as $$
declare e jsonb; accepted jsonb := '[]'::jsonb;
begin
  for e in select value from jsonb_array_elements(p_events) loop
    if e->>'kind'='revoked' then
      if p_restaurant is null then
        update public.whatsapp_accounts set status='reconnect_required',subscribed=false,token_ciphertext=null,
          verified_at=null,last_webhook_at=now(),last_error='meta_access_revoked'
        where provider='meta' and meta_app_id is null and waba_id=e->>'waba' and status='connected'
          and to_timestamp((e->>'time')::bigint) between greatest(now()-interval '7 days',date_trunc('second',operation_at)) and now()+interval '5 minutes';
      end if;
      continue;
    end if;
    perform 1 from public.whatsapp_accounts
    where provider='meta' and phone_id=e->>'phone' and waba_id=e->>'waba' and status='connected' and subscribed
      and ((p_restaurant is null and meta_app_id is null) or
           (restaurant_id=p_restaurant and meta_app_id is not null and app_secret_ciphertext=p_secret))
    for update;
    if found then accepted := accepted || e; end if;
  end loop;
  return public.whatsapp_ingest(accepted);
end $$;


revoke execute on function public.whatsapp_save_gupshup(uuid,text,text,text,text,text),
  public.whatsapp_ingest_gupshup(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.whatsapp_save_gupshup(uuid,text,text,text,text,text),
  public.whatsapp_ingest_gupshup(uuid,text,text,jsonb) to service_role;
-- Existing table grants and RLS remain service-role-only, including new columns.
commit;
