begin;

alter table public.whatsapp_accounts
  add column meta_app_id text check (meta_app_id ~ '^[0-9]{5,32}$'),
  add column app_secret_ciphertext text;

create unique index whatsapp_one_manual_app on public.whatsapp_accounts(meta_app_id)
  where meta_app_id is not null and status <> 'disconnected';

create function public.whatsapp_save_manual(
  p_restaurant uuid, p_phone text, p_waba text, p_display text, p_coexistence boolean,
  p_app text, p_secret text, p_token text, p_expires timestamptz, p_data_expires timestamptz
) returns text language plpgsql set search_path = '' as $$
begin
  perform 1 from public.restaurants where id=p_restaurant for update;
  if not found or not public.restaurant_subscription_active(p_restaurant) then return 'subscription_inactive'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ordova:whatsapp:waba:'||p_waba,0));
  if exists(select 1 from public.whatsapp_accounts where restaurant_id=p_restaurant
    and status in ('connecting','disconnecting')) then return 'account_operation_unavailable'; end if;
  if exists(select 1 from public.whatsapp_accounts where restaurant_id=p_restaurant and status<>'disconnected'
    and (phone_id<>p_phone or waba_id<>p_waba or meta_app_id is distinct from p_app)) then
    return 'disconnect_current_number';
  end if;
  insert into public.whatsapp_accounts as existing
    (restaurant_id,phone_id,waba_id,display_phone,coexistence,meta_app_id,app_secret_ciphertext,
      token_ciphertext,token_expires_at,data_access_expires_at,status,subscribed,verified_at)
  values(p_restaurant,p_phone,p_waba,p_display,p_coexistence,p_app,p_secret,p_token,p_expires,p_data_expires,'connected',true,now())
  on conflict(restaurant_id,phone_id) do update set
    waba_id=p_waba,display_phone=p_display,coexistence=p_coexistence,meta_app_id=p_app,
    app_secret_ciphertext=p_secret,token_ciphertext=p_token,token_expires_at=p_expires,data_access_expires_at=p_data_expires,
    status='connected',subscribed=true,verified_at=now(),last_error=null,onboarding_id=null,
    operation_at=case when existing.status='connected' then existing.operation_at else now() end,
    last_webhook_at=case when existing.status='disconnected' then null else existing.last_webhook_at end;
  return 'connected';
exception when unique_violation then return 'account_in_use';
end $$;

-- Keep source verification and ingestion in the same transaction so a replaced
-- credential or a reassigned phone cannot race a request signed by an old app.
create function public.whatsapp_ingest_verified(p_events jsonb,p_restaurant uuid,p_secret text)
returns integer language plpgsql set search_path = '' as $$
declare e jsonb; accepted jsonb := '[]'::jsonb;
begin
  for e in select value from jsonb_array_elements(p_events) loop
    if e->>'kind'='revoked' then
      if p_restaurant is null then
        update public.whatsapp_accounts set status='reconnect_required',subscribed=false,token_ciphertext=null,
          verified_at=null,last_webhook_at=now(),last_error='meta_access_revoked'
        where meta_app_id is null and waba_id=e->>'waba' and status='connected'
          and to_timestamp((e->>'time')::bigint) between greatest(now()-interval '7 days',date_trunc('second',operation_at)) and now()+interval '5 minutes';
      end if;
      continue;
    end if;
    perform 1 from public.whatsapp_accounts
    where phone_id=e->>'phone' and waba_id=e->>'waba' and status='connected' and subscribed
      and ((p_restaurant is null and meta_app_id is null) or
           (restaurant_id=p_restaurant and meta_app_id is not null and app_secret_ciphertext=p_secret))
    for update;
    if found then accepted := accepted || e; end if;
  end loop;
  return public.whatsapp_ingest(accepted);
end $$;

revoke execute on function public.whatsapp_save_manual(uuid,text,text,text,boolean,text,text,text,timestamptz,timestamptz),
  public.whatsapp_ingest_verified(jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.whatsapp_save_manual(uuid,text,text,text,boolean,text,text,text,timestamptz,timestamptz),
  public.whatsapp_ingest_verified(jsonb,uuid,text) to service_role;
commit;
