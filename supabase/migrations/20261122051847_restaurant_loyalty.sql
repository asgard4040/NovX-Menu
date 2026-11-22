begin;

create table public.loyalty_programs (
  restaurant_id uuid primary key references public.restaurants on delete cascade,
  enabled boolean not null default false,
  iqd_per_point integer not null check (iqd_per_point between 1 and 1000000),
  reward_name text not null check (length(btrim(reward_name)) between 1 and 80),
  reward_points integer not null check (reward_points between 1 and 1000000),
  reward_cost_iqd integer not null check (reward_cost_iqd between 0 and 1000000)
);

create table public.loyalty_cards (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default now() + interval '180 days',
  balance bigint not null default 0,
  unique (restaurant_id, token_hash),
  unique (restaurant_id, id)
);

create table public.loyalty_orders (
  order_id uuid primary key,
  restaurant_id uuid not null,
  card_id uuid not null,
  points integer not null check (points between 0 and 100000000),
  paid_at timestamptz,
  paid_by uuid references auth.users on delete set null,
  reversed_at timestamptz,
  reversed_by uuid references auth.users on delete set null,
  foreign key (restaurant_id, order_id) references public.orders(restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, card_id) references public.loyalty_cards(restaurant_id, id) on delete cascade
);
create index loyalty_orders_by_card on public.loyalty_orders (restaurant_id, card_id);
create index loyalty_orders_for_staff on public.loyalty_orders (restaurant_id, paid_at, order_id);

-- One active claim per card. Completed claims are retained to count redemptions.
create table public.loyalty_claims (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  card_id uuid not null,
  code_hash text not null,
  reward_name text not null,
  points integer not null check (points > 0),
  cost_iqd integer not null check (cost_iqd >= 0),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users on delete set null,
  foreign key (restaurant_id, card_id) references public.loyalty_cards(restaurant_id, id) on delete cascade,
  unique (restaurant_id, code_hash)
);
create unique index loyalty_one_open_claim on public.loyalty_claims (restaurant_id, card_id)
  where redeemed_at is null;
create index loyalty_claims_by_restaurant on public.loyalty_claims (restaurant_id, redeemed_at);

do $$
declare table_name text;
begin
  foreach table_name in array array['loyalty_programs','loyalty_cards','loyalty_orders','loyalty_claims'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
  end loop;
end $$;

-- Guest entry points are service-only. Browser requests prove possession of
-- the per-restaurant cookie and never supply a card ID.
create function public.loyalty_guest(p_restaurant uuid, p_token_hash text, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  program public.loyalty_programs;
  card public.loyalty_cards;
  code text;
  history jsonb;
begin
  select * into program from public.loyalty_programs where restaurant_id = p_restaurant;
  if not coalesce(program.enabled, false) or not public.restaurant_subscription_active(p_restaurant) then
    if p_action = 'read' then return jsonb_build_object('enabled', false); end if;
    raise exception 'loyalty_unavailable';
  end if;

  if p_action = 'join' then
    insert into public.loyalty_cards (restaurant_id, token_hash)
    values (p_restaurant, p_token_hash)
    on conflict (restaurant_id, token_hash) do nothing;
  end if;

  select * into card from public.loyalty_cards
  where restaurant_id = p_restaurant and token_hash = p_token_hash and expires_at > now()
  for update;
  if p_action = 'claim' then
    if card.id is null then raise exception 'loyalty_card_required'; end if;
    if card.balance < program.reward_points then raise exception 'loyalty_insufficient_points'; end if;
    code := upper(encode(extensions.gen_random_bytes(6), 'hex'));
    insert into public.loyalty_claims (restaurant_id, card_id, code_hash, reward_name, points, cost_iqd, expires_at)
    values (p_restaurant, card.id, encode(extensions.digest(code, 'sha256'), 'hex'),
      program.reward_name, program.reward_points, program.reward_cost_iqd, now() + interval '5 minutes')
    on conflict (restaurant_id, card_id) where redeemed_at is null do update set
      code_hash = excluded.code_hash, reward_name = excluded.reward_name, points = excluded.points,
      cost_iqd = excluded.cost_iqd, expires_at = excluded.expires_at;
    return jsonb_build_object('code', code, 'rewardName', program.reward_name, 'expiresIn', 300);
  end if;
  if p_action not in ('read', 'join') then raise exception 'invalid_loyalty_action'; end if;

  -- Expose only cart fields and order status. Notes, location, table, device
  -- data, and tracking credentials are not part of the wallet.
  select coalesce(jsonb_agg(to_jsonb(recent) order by recent."createdAt" desc, recent.id), '[]'::jsonb)
  into history from (
    select o.id, o.order_number as "orderNumber", o.created_at as "createdAt", o.status,
      l.paid_at is not null and l.reversed_at is null as paid, l.reversed_at is not null as reversed, l.points,
      (select jsonb_agg(jsonb_build_object('id', item->>'id', 'name', item->>'name',
         'quantity', item->'quantity', 'cheeseSelected', item->'cheeseSelected',
         'spicySelected', item->'spicySelected'))
       from jsonb_array_elements(o.items) item) as items
    from public.loyalty_orders l
    join public.orders o on o.restaurant_id = l.restaurant_id and o.id = l.order_id
    where l.restaurant_id = p_restaurant and l.card_id = card.id
    order by o.created_at desc, o.id limit 10
  ) recent;

  return jsonb_build_object('enabled', true, 'joined', card.id is not null,
    'balance', greatest(0, card.balance), 'iqdPerPoint', program.iqd_per_point,
    'rewardName', program.reward_name, 'rewardPoints', program.reward_points, 'orders', history);
end $$;

-- Serialize on the same restaurant row the existing order writer locks.
-- Attaching the card and creating the order are one transaction. A retry can
-- report the original link, but can never graft a card onto a different order.
create function public.loyalty_create_order(
  p_restaurant_id uuid, p_customer_name text, p_table_number text, p_notes text,
  p_items jsonb, p_lat float8, p_lon float8, p_accuracy float8,
  p_fingerprint text, p_idempotency_key text, p_tracking_token text, p_token_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  program public.loyalty_programs;
  selected_card_id uuid;
  prior_order uuid;
  created jsonb;
  attached boolean;
begin
  perform 1 from public.restaurants where id = p_restaurant_id for update;
  select resource_id into prior_order from public.idempotency_keys
    where scope = 'order' and restaurant_id = p_restaurant_id and key = p_idempotency_key;
  select c.id into selected_card_id from public.loyalty_cards c
    where c.restaurant_id = p_restaurant_id and c.token_hash = p_token_hash and c.expires_at > now();

  created := public.create_customer_order(p_restaurant_id, p_customer_name, p_table_number,
    p_notes, p_items, p_lat, p_lon, p_accuracy, p_fingerprint, p_idempotency_key, p_tracking_token);
  if created is null then return null; end if;
  select * into program from public.loyalty_programs where restaurant_id = p_restaurant_id;
  if prior_order is null and selected_card_id is not null and program.enabled then
    insert into public.loyalty_orders (order_id, restaurant_id, card_id, points)
    values ((created->>'id')::uuid, p_restaurant_id, selected_card_id,
      least(100000000, floor((created->>'total_amount')::numeric / program.iqd_per_point))::integer);
  end if;
  select exists (select 1 from public.loyalty_orders
    where order_id = (created->>'id')::uuid and restaurant_id = p_restaurant_id
    and loyalty_orders.card_id = selected_card_id) into attached;
  return created || jsonb_build_object('loyalty_attached', attached);
end $$;

create function public.loyalty_staff(p_restaurant uuid, p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  role public.member_role;
  can_manage boolean;
  program public.loyalty_programs;
  order_row public.orders;
  linked public.loyalty_orders;
  claim public.loyalty_claims;
  requested_code_hash text;
  current_balance bigint;
  settlements jsonb;
  stats jsonb;
begin
  select m.role into role from public.restaurant_members m
    where m.restaurant_id = p_restaurant and m.user_id = auth.uid() and m.active;
  if role is null or role not in ('owner','manager','waiter') then
    raise exception 'loyalty_forbidden' using errcode = '42501';
  end if;
  if not public.restaurant_subscription_active(p_restaurant) then raise exception 'loyalty_unavailable'; end if;
  can_manage := role in ('owner','manager');

  if p_action = 'configure' then
    if not can_manage then raise exception 'loyalty_forbidden' using errcode = '42501'; end if;
    insert into public.loyalty_programs (restaurant_id, enabled, iqd_per_point, reward_name, reward_points, reward_cost_iqd)
    values (p_restaurant, (p_data->>'enabled')::boolean, (p_data->>'iqdPerPoint')::integer,
      btrim(p_data->>'rewardName'), (p_data->>'rewardPoints')::integer, (p_data->>'rewardCostIqd')::integer)
    on conflict (restaurant_id) do update set enabled = excluded.enabled,
      iqd_per_point = excluded.iqd_per_point, reward_name = excluded.reward_name,
      reward_points = excluded.reward_points, reward_cost_iqd = excluded.reward_cost_iqd;
  end if;
  select * into program from public.loyalty_programs where restaurant_id = p_restaurant;

  if p_action in ('read', 'configure') then
    select coalesce(jsonb_agg(to_jsonb(recent) order by recent."createdAt" desc, recent.id), '[]'::jsonb)
      into settlements from (
        select o.id, o.order_number as "orderNumber", o.table_number as "tableNumber",
          o.total_amount as "totalAmount", o.created_at as "createdAt",
          l.points, l.paid_at as "paidAt", l.reversed_at as "reversedAt"
        from public.loyalty_orders l join public.orders o on o.restaurant_id = l.restaurant_id and o.id = l.order_id
        where l.restaurant_id = p_restaurant and o.status = 'served' and (l.paid_at is null or can_manage)
        order by (l.paid_at is null) desc, o.created_at desc, o.id limit 50
      ) recent;
    if can_manage then
      select jsonb_build_object(
        'members', (select count(*) from public.loyalty_cards c where c.restaurant_id = p_restaurant),
        'returningMembers', (select count(*) from (
          select card_id from public.loyalty_orders l where l.restaurant_id = p_restaurant
          and paid_at is not null and reversed_at is null group by card_id having count(*) > 1) returning_cards),
        'paidOrders', (select count(*) from public.loyalty_orders l where l.restaurant_id = p_restaurant
          and paid_at is not null and reversed_at is null),
        'rewards', (select count(*) from public.loyalty_claims c where c.restaurant_id = p_restaurant and redeemed_at is not null),
        'rewardCostIqd', (select coalesce(sum(cost_iqd), 0) from public.loyalty_claims c
          where c.restaurant_id = p_restaurant and redeemed_at is not null)
      ) into stats;
    end if;
    return jsonb_build_object('program', case when program.restaurant_id is not null then to_jsonb(program) - 'restaurant_id' end,
      'orders', settlements, 'stats', stats);
  end if;

  if p_action in ('confirm_paid','reverse_payment') then
    if p_action = 'reverse_payment' and not can_manage then raise exception 'loyalty_forbidden' using errcode = '42501'; end if;
    select * into order_row from public.orders where restaurant_id = p_restaurant and id = (p_data->>'orderId')::uuid for update;
    if order_row.status is distinct from 'served' then raise exception 'loyalty_order_not_served'; end if;
    select * into linked from public.loyalty_orders where restaurant_id = p_restaurant and order_id = order_row.id for update;
    if linked.order_id is null then raise exception 'loyalty_order_not_linked'; end if;

    if p_action = 'confirm_paid' and linked.paid_at is null then
      update public.loyalty_cards set balance = loyalty_cards.balance + linked.points
        where restaurant_id = p_restaurant and id = linked.card_id;
      update public.loyalty_orders set paid_at = now(), paid_by = auth.uid() where order_id = linked.order_id;
    elsif p_action = 'reverse_payment' and linked.paid_at is not null and linked.reversed_at is null then
      update public.loyalty_cards set balance = loyalty_cards.balance - linked.points
        where restaurant_id = p_restaurant and id = linked.card_id;
      update public.loyalty_orders set reversed_at = now(), reversed_by = auth.uid() where order_id = linked.order_id;
    elsif p_action = 'confirm_paid' and linked.reversed_at is not null then
      raise exception 'loyalty_payment_reversed';
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'redeem' then
    if not coalesce(program.enabled, false) then raise exception 'loyalty_unavailable'; end if;
    if coalesce(p_data->>'code','') !~ '^[0-9A-F]{12}$' then raise exception 'loyalty_invalid_code'; end if;
    requested_code_hash := encode(extensions.digest(p_data->>'code', 'sha256'), 'hex');
    select * into claim from public.loyalty_claims c where c.restaurant_id = p_restaurant and c.code_hash = requested_code_hash;
    if claim.id is null then raise exception 'loyalty_invalid_code'; end if;
    select c.balance into current_balance from public.loyalty_cards c where c.restaurant_id = p_restaurant
      and c.id = claim.card_id and c.expires_at > now() for update;
    -- Re-read after acquiring the card lock. Issuing a code and redeeming it
    -- take locks in the same order.
    select * into claim from public.loyalty_claims c where c.restaurant_id = p_restaurant and c.code_hash = requested_code_hash for update;
    if claim.id is null or claim.expires_at <= now() or claim.redeemed_at is not null or current_balance is null then
      raise exception 'loyalty_invalid_code';
    end if;
    if current_balance < claim.points then raise exception 'loyalty_insufficient_points'; end if;
    update public.loyalty_cards set balance = loyalty_cards.balance - claim.points
      where restaurant_id = p_restaurant and id = claim.card_id;
    update public.loyalty_claims set redeemed_at = now(), redeemed_by = auth.uid() where id = claim.id;
    return jsonb_build_object('rewardName', claim.reward_name, 'points', claim.points);
  end if;
  raise exception 'invalid_loyalty_action';
end $$;

create function ordova_private.loyalty_reverse_cancelled_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare linked public.loyalty_orders;
begin
  update public.loyalty_orders set reversed_at = now(), reversed_by = auth.uid()
    where order_id = new.id and restaurant_id = new.restaurant_id
    and paid_at is not null and reversed_at is null returning * into linked;
  if found then
    update public.loyalty_cards set balance = balance - linked.points
      where restaurant_id = linked.restaurant_id and id = linked.card_id;
  end if;
  return new;
end $$;
create trigger loyalty_reverse_cancelled_order after update of status on public.orders
  for each row when (old.status = 'served' and new.status in ('cancelled', 'rejected'))
  execute function ordova_private.loyalty_reverse_cancelled_order();

revoke execute on function public.loyalty_guest(uuid,text,text),
  public.loyalty_create_order(uuid,text,text,text,jsonb,float8,float8,float8,text,text,text,text),
  public.loyalty_staff(uuid,text,jsonb), ordova_private.loyalty_reverse_cancelled_order()
  from public, anon, authenticated;
grant execute on function public.loyalty_guest(uuid,text,text),
  public.loyalty_create_order(uuid,text,text,text,jsonb,float8,float8,float8,text,text,text,text) to service_role;
grant execute on function public.loyalty_staff(uuid,text,jsonb) to authenticated;

commit;
