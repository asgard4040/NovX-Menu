begin;

-- Existing installations that already ran 202610180002 may have a one-restaurant-per-user key.
alter table public.staff_passcodes drop constraint if exists staff_passcodes_pkey;
alter table public.staff_passcodes add primary key (restaurant_id, user_id);

commit;
