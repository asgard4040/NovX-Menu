-- Store notification_dispatcher_cron_secret and notification_dispatcher_anon_key
-- in Supabase Vault before applying this migration. Never put their values here.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notification_dispatcher_cron_secret')
     or not exists (select 1 from vault.secrets where name = 'notification_dispatcher_anon_key') then
    raise exception 'Notification dispatcher Vault secrets are missing';
  end if;
end $$;

select cron.schedule(
  'notification-dispatcher-every-minute',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://vqaigwzurejqicshhkwt.supabase.co/functions/v1/notification-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notification_dispatcher_anon_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'notification_dispatcher_anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notification_dispatcher_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $job$
);
