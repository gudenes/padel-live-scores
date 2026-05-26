-- supabase/migrations/20260526_seo_dashboard.sql
-- SEO daily dashboard tables. All server-only (no RLS policies for anon).
-- See docs/superpowers/specs/2026-05-25-seo-daily-dashboard-design.md.

create table public.seo_snapshots (
  day          date    not null,
  locale       text    not null check (locale in ('total','en','es','pt','it','fr')),
  clicks       integer not null default 0,
  impressions  integer not null default 0,
  avg_position numeric(5,2),
  ctr          numeric(6,4),
  fetched_at   timestamptz not null default now(),
  primary key (day, locale)
);
create index seo_snapshots_locale_day_idx
  on public.seo_snapshots (locale, day desc);

create table public.seo_top_queries (
  day         date    not null,
  query       text    not null,
  clicks      integer not null,
  impressions integer not null,
  position    numeric(5,2),
  rank        smallint not null,
  primary key (day, query)
);
create index seo_top_queries_day_rank_idx
  on public.seo_top_queries (day desc, rank);

create table public.seo_top_pages (
  day         date    not null,
  url         text    not null,
  locale      text    not null,
  page_type   text    not null,
  clicks      integer not null,
  impressions integer not null,
  position    numeric(5,2),
  rank        smallint not null,
  primary key (day, url)
);
create index seo_top_pages_day_locale_impressions_idx
  on public.seo_top_pages (day desc, locale, impressions desc);

create table public.sitemap_url_snapshot (
  day        date    not null,
  url        text    not null,
  locale     text    not null,
  page_type  text    not null,
  primary key (day, url)
);
create index sitemap_url_snapshot_day_locale_idx
  on public.sitemap_url_snapshot (day desc, locale);

create table public.seo_digest_sends (
  digest_date date    not null,
  recipient   text    not null,
  sent_at     timestamptz not null default now(),
  status      text    not null check (status in ('sent','failed','skipped_no_data')),
  error       text,
  primary key (digest_date, recipient)
);

-- RLS: deny anon by default (service-role key bypasses). The dashboard
-- reads via pgPool which uses the DATABASE_URL connection that bypasses RLS.
alter table public.seo_snapshots         enable row level security;
alter table public.seo_top_queries       enable row level security;
alter table public.seo_top_pages         enable row level security;
alter table public.sitemap_url_snapshot  enable row level security;
alter table public.seo_digest_sends      enable row level security;
