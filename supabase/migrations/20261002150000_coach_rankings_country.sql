-- Adds coaches.country to coach_rankings_public (Rankings Coaches tab + coach pages show nationality).
-- Only change vs 20261002140000: `country` appended as the LAST column so
-- `create or replace view` is allowed. Everything else (security_barrier, grants) is unchanged.

set local lock_timeout = '5s';

create or replace view public.coach_rankings_public with (security_barrier = true) as
with agg as (
  select
    c.id as coach_id, c.display_name, c.slug, c.country,
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
    then rank() over (partition by (a.women_points > 0) order by a.women_points desc) end as rank_women,
  a.country
from agg a
where a.player_count > 0;

revoke all on public.coach_rankings_public from public, anon, authenticated;
grant select on public.coach_rankings_public to anon, authenticated, service_role;

do $$
begin
  assert exists (select 1 from information_schema.columns where table_schema='public' and table_name='coach_rankings_public' and column_name='country'), 'coach_rankings_public.country missing';
end $$;

notify pgrst, 'reload schema';
