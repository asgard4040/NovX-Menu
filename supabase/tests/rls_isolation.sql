-- Run with `supabase test db` after applying migrations locally.
begin;
select plan(5);
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-000000000001','owner-a@test.invalid'),
  ('00000000-0000-0000-0000-000000000002','owner-b@test.invalid');
insert into public.restaurants(id,manager_name,restaurant_name,username,start_date,end_date) values
  ('10000000-0000-0000-0000-000000000001','A','A','a',now()-interval '1 day',now()+interval '1 month'),
  ('10000000-0000-0000-0000-000000000002','B','B','b',now()-interval '1 day',now()+interval '1 month');
insert into public.restaurant_members values
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner',true,now()),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','owner',true,now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((select count(*)::int from public.restaurants),1,'owner sees one restaurant');
select is((select count(*)::int from public.restaurants where id='10000000-0000-0000-0000-000000000002'),0,'cross-tenant restaurant is hidden');
select is((with changed as (update public.restaurants set restaurant_name='stolen' where id='10000000-0000-0000-0000-000000000002' returning 1) select count(*)::int from changed),0,'cross-tenant update changes zero rows');
select throws_ok($$insert into public.restaurant_members(restaurant_id,user_id,role) values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','manager')$$,null,null,'owner cannot grant another tenant membership');
reset role;
set local role anon;
select is((select count(*)::int from public.restaurants),0,'anonymous cannot read private restaurant rows');
select * from finish();
rollback;
