begin;

-- Four-digit codes are encrypted and keyed-hashed by the server. Never expose this table to browser clients.
create table if not exists public.staff_passcodes (
  user_id uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid not null,
  role public.member_role not null,
  code_digest text not null unique,
  code_ciphertext text not null,
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, user_id),
  constraint staff_passcodes_membership_fk foreign key (restaurant_id, user_id)
    references public.restaurant_members(restaurant_id, user_id) on delete cascade,
  constraint staff_passcodes_role_check check (role in ('owner', 'manager', 'waiter', 'kitchen')),
  constraint staff_passcodes_digest_check check (code_digest ~ '^[a-f0-9]{64}$')
);

create index if not exists staff_passcodes_restaurant_role_idx on public.staff_passcodes (restaurant_id, role);
alter table public.staff_passcodes enable row level security;
revoke all on public.staff_passcodes from anon, authenticated;
grant all on public.staff_passcodes to service_role;

-- Shared throttling survives serverless cold starts. Keys are HMACs, not raw IP addresses.
create table if not exists public.passcode_login_limits (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  client_key text not null,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  primary key (restaurant_id, client_key)
);
alter table public.passcode_login_limits enable row level security;
revoke all on public.passcode_login_limits from anon, authenticated;
grant all on public.passcode_login_limits to service_role;

create or replace function public.claim_passcode_attempt(
  p_restaurant_id uuid, p_client_key text, p_limit integer, p_window_seconds integer
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_attempts integer;
begin
  if p_client_key !~ '^[a-f0-9]{64}$' or p_limit not between 1 and 100 or p_window_seconds not between 60 and 86400 then
    raise exception 'invalid_attempt_limit';
  end if;
  insert into public.passcode_login_limits (restaurant_id, client_key, attempts, window_started_at)
  values (p_restaurant_id, p_client_key, 1, now())
  on conflict (restaurant_id, client_key) do update set
    attempts = case when public.passcode_login_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
      then 1 else public.passcode_login_limits.attempts + 1 end,
    window_started_at = case when public.passcode_login_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
      then now() else public.passcode_login_limits.window_started_at end
  returning attempts into v_attempts;
  if random() < 0.01 then
    delete from public.passcode_login_limits where window_started_at < now() - interval '7 days';
  end if;
  return v_attempts <= p_limit;
end $$;
revoke all on function public.claim_passcode_attempt(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_passcode_attempt(uuid, text, integer, integer) to service_role;

commit;
