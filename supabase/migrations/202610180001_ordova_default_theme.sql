-- New restaurants use the Ordova identity unless a different theme is chosen.
-- Existing restaurant themes and custom color overrides remain untouched.
alter table public.restaurants alter column theme_id set default 'ordova';
