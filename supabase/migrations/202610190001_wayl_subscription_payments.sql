begin;

create table if not exists public.subscription_payments (
  reference_id text primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  amount_iqd bigint not null check (amount_iqd > 0),
  environment text not null check (environment in ('test', 'live')),
  duration text not null check (duration in ('week', 'month', 'six-months', 'year')),
  webhook_secret text not null,
  wayl_link_id text,
  checkout_url text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'superseded')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists subscription_payments_restaurant_idx on public.subscription_payments(restaurant_id, created_at desc);
create unique index if not exists subscription_payments_one_pending_idx on public.subscription_payments(restaurant_id) where status = 'pending';
alter table public.subscription_payments enable row level security;
revoke all on public.subscription_payments from anon, authenticated;

create or replace function public.apply_paid_subscription(p_reference_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare payment public.subscription_payments; restaurant public.restaurants; begins_at timestamptz; renewal_end timestamptz;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  select * into payment from public.subscription_payments where reference_id = p_reference_id for update;
  if payment.reference_id is null then raise exception 'payment_not_found'; end if;
  if payment.status = 'paid' then return false; end if;
  select * into restaurant from public.restaurants where id = payment.restaurant_id for update;
  if restaurant.id is null then raise exception 'restaurant_not_found'; end if;
  -- Preserve an administrator suspension even when an earlier checkout is paid.
  begins_at := greatest(now(), restaurant.end_date);
  renewal_end := case payment.duration
    when 'week' then begins_at + interval '7 days'
    when 'month' then begins_at + interval '1 month'
    when 'six-months' then begins_at + interval '6 months'
    when 'year' then begins_at + interval '1 year'
  end;
  update public.restaurants set start_date = least(start_date, now()), end_date = renewal_end,
    updated_at = now() where id = payment.restaurant_id;
  update public.subscription_payments set status = 'paid', paid_at = now() where reference_id = p_reference_id;
  return true;
end $$;
revoke all on function public.apply_paid_subscription(text) from public, anon, authenticated;
grant execute on function public.apply_paid_subscription(text) to service_role;

commit;
