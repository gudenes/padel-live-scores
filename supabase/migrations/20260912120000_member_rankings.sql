-- 20260912120000_member_rankings.sql
-- SNP publishes two rankings per player per season: national (Spain) and
-- zonal (Catalunya/Barcelona). Both live on team_memberships, which is
-- already the per-player, per-season row.
--
-- competition_rank is dropped. It is NULL in all 24 rows - verified before
-- writing this - and its name says nothing once two named rankings exist.

alter table public.team_memberships
  add column if not exists national_rank int,
  add column if not exists local_rank    int,
  add column if not exists is_captain    boolean not null default false;

alter table public.team_memberships
  drop column if exists competition_rank;

comment on column public.team_memberships.national_rank is
  'SNP national position for the season. NULL when the source says s/d.';
comment on column public.team_memberships.local_rank is
  'SNP zonal position (Catalunya/Barcelona). The one the profile leads with.';
comment on column public.team_memberships.is_captain is
  'Season captain. One per team today; becomes a role column if SNP ever
   distinguishes captain from delegate.';
