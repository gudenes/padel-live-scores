-- apps/ops/scripts/seed-growth-sample.sql
-- LOCAL / DEV ONLY. Fills public.growth_snapshots with invented PostHog-shaped
-- sample rows (yesterday's snapshot + 30 days of DAU + 9 retention cohorts) so
-- the /growth page can be reviewed without a PostHog key.
--
-- Touches ONLY growth_snapshots (never profiles/push/bookmarks), and upserts,
-- so it is safe to re-run. Do NOT run against production: real snapshots for
-- the same days would be overwritten with fake numbers.
--
--   psql "$DATABASE_URL" -f supabase/migrations/20260930120000_growth_snapshots.sql   # once
--   psql "$DATABASE_URL" -f apps/ops/scripts/seed-growth-sample.sql
--
-- Remove the sample rows afterwards:
--   delete from public.growth_snapshots where day >= current_date - 40;

insert into public.growth_snapshots (day, metric, dimension, value)
select (current_date - 1) - (29 - g), 'dau', '',
       round(820 + g * 14 + sin(g / 2.2) * 70 + random() * 50)
  from generate_series(0, 29) g
on conflict (day, metric, dimension) do update set value = excluded.value, fetched_at = now();

insert into public.growth_snapshots (day, metric, dimension, value) values
  (current_date - 1, 'wau', '', 2950),
  (current_date - 1, 'mau', '', 7600),
  (current_date - 1, 'funnel', 'visitors', 7600),
  (current_date - 1, 'funnel', 'signed_up', 980),
  (current_date - 1, 'funnel', 'bookmarked_player', 372),
  (current_date - 1, 'funnel', 'push', 216),
  (current_date - 1, 'channel', 'Organic search', 3650),
  (current_date - 1, 'channel', 'Direct', 1980),
  (current_date - 1, 'channel', 'Social', 1140),
  (current_date - 1, 'channel', 'Referral', 830),
  (current_date - 1, 'country', 'ES', 2600),
  (current_date - 1, 'country', 'AR', 1400),
  (current_date - 1, 'country', 'IT', 900),
  (current_date - 1, 'country', 'BR', 760),
  (current_date - 1, 'country', 'FR', 690),
  (current_date - 1, 'country', 'GB', 520)
on conflict (day, metric, dimension) do update set value = excluded.value, fetched_at = now();

-- 9 weekly cohorts (Monday-start weeks), cohort k is k weeks old
insert into public.growth_snapshots (day, metric, dimension, value)
select current_date - 1, 'retention_cohort', to_char(c, 'YYYY-MM-DD'), sz
  from (select date_trunc('week', current_date - 1)::date - k * 7 as c, 200 + k * 9 as sz
          from generate_series(1, 9) k) x
on conflict (day, metric, dimension) do update set value = excluded.value, fetched_at = now();

insert into public.growth_snapshots (day, metric, dimension, value)
select current_date - 1, 'retention', to_char(c, 'YYYY-MM-DD') || ':' || n,
       round(sz * case n when 0 then 1 else 0.46 * power(0.83, n - 1) end)
  from (select date_trunc('week', current_date - 1)::date - k * 7 as c, 200 + k * 9 as sz, k
          from generate_series(1, 9) k) x,
       generate_series(0, 8) n
 where n < k
on conflict (day, metric, dimension) do update set value = excluded.value, fetched_at = now();
