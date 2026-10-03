-- Append avatar URLs without changing existing column order, ranking logic or access rules.
set local lock_timeout = '5s';

create or replace view public.coach_stats with (security_invoker = true) as
select
  c.id as coach_id,
  c.display_name,
  c.normalized_name,
  c.slug,
  c.status,
  c.player_id,
  count(p.id)::int as player_count,
  coalesce(sum(p.points) filter (where p.category = 'men'), 0)::numeric as men_points,
  coalesce(sum(p.points) filter (where p.category = 'women'), 0)::numeric as women_points,
  coalesce(sum(p.points), 0)::numeric as total_points,
  (select count(*) from public.coach_aliases a where a.coach_id = c.id)::int as variant_count,
  c.avatar_url
from public.coaches c
left join public.player_coaches pc on pc.coach_id = c.id
left join public.players p on p.id = pc.player_id and coalesce(p.tier, 'pro') = 'pro'
where c.status <> 'merged'
group by c.id;

create or replace view public.coach_rankings_public with (security_barrier = true) as
with agg as (
  select
    c.id as coach_id, c.display_name, c.slug, c.country, c.avatar_url,
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
  a.country, a.avatar_url
from agg a
where a.player_count > 0;

revoke all on public.coach_rankings_public from public, anon, authenticated;
grant select on public.coach_rankings_public to anon, authenticated, service_role;


create or replace view public.player_coaches_public with (security_barrier = true) as
select pc.player_id, pc.position, c.id as coach_id, c.display_name, c.slug, c.avatar_url
from public.player_coaches pc
join public.coaches c on c.id = pc.coach_id
where c.status in ('unreviewed', 'verified');

-- Supabase default privileges grant ALL on new public relations to
-- anon/authenticated/service_role, so strip them explicitly, then grant SELECT only.
revoke all on public.player_coaches_public from public, anon, authenticated;
grant select on public.player_coaches_public to anon, authenticated, service_role;


notify pgrst, 'reload schema';
