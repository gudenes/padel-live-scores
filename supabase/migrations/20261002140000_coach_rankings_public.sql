-- Public projections for the coach pages (spec 2026-10-02-coach-pages-design.md).
-- Owner-rights views on purpose (no security_invoker): coaches/player_coaches keep
-- RLS with no anon policy, so these views are the only anon path, exposing only the
-- listed columns. coach_rankings_public deliberately reads the BASE tables, NOT
-- coach_stats: coach_stats is security_invoker, and Postgres checks a security_invoker
-- view with the CURRENT user's permissions even when reached from an owner-rights
-- view, so anon would get zero rows. Supabase's advisor flags owner-rights views;
-- these are intentional. Writes are explicitly revoked because Supabase's default
-- privileges grant ALL on new public relations to anon.

set local lock_timeout = '5s';

create or replace view public.coach_rankings_public with (security_barrier = true) as
with agg as (
  select
    c.id as coach_id, c.display_name, c.slug,
    count(p.id)::int as player_count,
    coalesce(sum(p.points) filter (where p.category = 'men'), 0)::bigint as men_points,
    coalesce(sum(p.points) filter (where p.category = 'women'), 0)::bigint as women_points,
    coalesce(sum(p.points), 0)::bigint as total_points
  from public.coaches c
  join public.player_coaches pc on pc.coach_id = c.id
  join public.players p on p.id = pc.player_id and coalesce(p.tier, 'pro') = 'pro'
  where c.status in ('unreviewed', 'verified')
  group by c.id
)
select
  a.coach_id, a.display_name, a.slug, a.player_count,
  a.men_points, a.women_points, a.total_points,
  rank() over (order by a.total_points desc) as rank_overall,
  case when a.men_points > 0
    then rank() over (partition by (a.men_points > 0) order by a.men_points desc) end as rank_men,
  case when a.women_points > 0
    then rank() over (partition by (a.women_points > 0) order by a.women_points desc) end as rank_women
from agg a
where a.player_count > 0;

create or replace view public.coach_slug_redirects with (security_barrier = true) as
select m.slug as old_slug, t.slug as new_slug
from public.coaches m
join public.coaches t on t.id = m.merged_into
where m.status = 'merged';

revoke all on public.coach_rankings_public, public.coach_slug_redirects from public, anon, authenticated;
grant select on public.coach_rankings_public, public.coach_slug_redirects to anon, authenticated, service_role;

do $$
begin
  assert exists (select 1 from information_schema.views where table_schema='public' and table_name='coach_rankings_public'), 'coach_rankings_public missing';
  assert exists (select 1 from information_schema.views where table_schema='public' and table_name='coach_slug_redirects'), 'coach_slug_redirects missing';
end $$;

notify pgrst, 'reload schema';
