-- 20260909200000_team_cover.sql
-- Cover image for the public team page hero. Nullable: without it the hero
-- falls back to a brand gradient, which is the state of every team today.

alter table public.teams
  add column if not exists cover_image_url text;

comment on column public.teams.cover_image_url is
  'Hero background for /snp/<slug>. Null = brand gradient fallback.';
