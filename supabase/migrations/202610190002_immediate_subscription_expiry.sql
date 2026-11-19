begin;
-- Payment is now required when the plan end date is reached.
alter table public.restaurants alter column grace_period_days set default 0;
update public.restaurants set grace_period_days = 0, updated_at = now() where grace_period_days <> 0;
commit;
