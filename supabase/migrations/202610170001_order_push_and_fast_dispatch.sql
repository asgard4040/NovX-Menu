begin;

-- Emit exactly one push event for each durable order transition, regardless of
-- which API or staff screen caused it. The order transaction is the source of truth.
create or replace function public.queue_order_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare event_name text;
begin
  if tg_op = 'INSERT' then
    event_name := case when new.status = 'pending' then 'customer_order' when new.status = 'preparing' then 'kitchen_order' end;
  elsif old.status is distinct from new.status then
    event_name := case when new.status = 'preparing' then 'kitchen_order' when new.status = 'ready' then 'order_ready' end;
  end if;
  if event_name is not null then
    insert into public.notification_outbox(restaurant_id, event_type, payload)
    values (new.restaurant_id, event_name, jsonb_build_object(
      'order_id', new.id, 'order_number', new.order_number,
      'table_number', new.table_number, 'status', new.status));
  end if;
  return new;
end $$;

drop trigger if exists orders_queue_notification on public.orders;
create trigger orders_queue_notification after insert or update of status on public.orders
for each row execute function public.queue_order_notification();

-- Atomic leasing prevents the immediate HTTP dispatch and the minute cron
-- fallback from sending the same event simultaneously.
alter table public.notification_outbox add column if not exists lease_until timestamptz;
create index if not exists notification_outbox_due_idx
on public.notification_outbox(created_at, id) where processed_at is null and attempts < 5;

create or replace function public.claim_notification_outbox(p_limit integer default 50)
returns setof public.notification_outbox language sql security definer set search_path = '' as $$
  update public.notification_outbox o
  set lease_until = now() + interval '2 minutes'
  where o.id in (
    select id from public.notification_outbox
    where processed_at is null and attempts < 5
      and (lease_until is null or lease_until < now())
    order by created_at, id limit least(greatest(p_limit, 1), 100)
    for update skip locked
  )
  returning o.*;
$$;
revoke all on function public.claim_notification_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_outbox(integer) to service_role;

-- pg_net starts after commit, so a notification failure cannot roll back an
-- order. The existing cron job remains as a recovery path.
create or replace function public.dispatch_notification_soon() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cron_secret text; anon_key text;
begin
  select decrypted_secret into cron_secret from vault.decrypted_secrets
    where name = 'notification_dispatcher_cron_secret';
  select decrypted_secret into anon_key from vault.decrypted_secrets
    where name = 'notification_dispatcher_anon_key';
  if cron_secret is not null and anon_key is not null then
    perform net.http_post(
      url := 'https://vqaigwzurejqicshhkwt.supabase.co/functions/v1/notification-dispatcher',
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer ' || anon_key, 'apikey',anon_key,
        'x-cron-secret',cron_secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  end if;
  return new;
exception when others then
  -- Cron will retry; never lose the original order/request.
  return new;
end $$;

drop trigger if exists notification_outbox_dispatch_soon on public.notification_outbox;
create trigger notification_outbox_dispatch_soon after insert on public.notification_outbox
for each row execute function public.dispatch_notification_soon();

commit;
