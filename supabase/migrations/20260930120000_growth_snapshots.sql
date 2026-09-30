-- supabase/migrations/20260930120000_growth_snapshots.sql
-- Daily PostHog-derived growth metrics for the admin "Growth & Adoption" page.
-- Long-form (day, metric, dimension) so adding a metric needs no schema change.
-- Server-only: no RLS policies for anon (same as seo_snapshots).
--
-- metric / dimension conventions (written by /api/internal/growth-snapshot):
--   dau | wau | mau                 dimension ''            value = distinct persons
--   funnel                          dimension = step key    value = persons/users
--   channel                         dimension = channel     value = distinct persons (30d)
--   country                         dimension = ISO code    value = distinct persons (30d)
--   retention_cohort                dimension = cohort week value = cohort size
--   retention                       dimension = 'YYYY-MM-DD:N' (cohort week : weeks later)
--                                                           value = retained persons

create table if not exists public.growth_snapshots (
  day        date    not null,
  metric     text    not null,
  dimension  text    not null default '',
  value      numeric not null,
  fetched_at timestamptz not null default now(),
  primary key (day, metric, dimension)
);

create index if not exists growth_snapshots_metric_day_idx
  on public.growth_snapshots (metric, day desc);

alter table public.growth_snapshots enable row level security;
