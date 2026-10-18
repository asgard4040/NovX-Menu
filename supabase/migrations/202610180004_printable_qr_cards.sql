begin;

alter table public.restaurants
  add column if not exists table_count integer not null default 0,
  add column if not exists qr_design text not null default 'ordova';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_table_count_check' and conrelid = 'public.restaurants'::regclass) then
    alter table public.restaurants add constraint restaurants_table_count_check check (table_count between 0 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restaurants_qr_design_check' and conrelid = 'public.restaurants'::regclass) then
    alter table public.restaurants add constraint restaurants_qr_design_check check (qr_design in ('ordova', 'minimal', 'cafe', 'bold'));
  end if;
end $$;

commit;
