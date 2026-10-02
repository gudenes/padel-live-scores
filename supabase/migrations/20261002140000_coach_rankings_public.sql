-- Public projections for the coach pages (spec 2026-10-02-coach-pages-design.md).
-- Owner-rights views on purpose (no security_invoker): coaches/player_coaches keep
-- RLS with no anon policy and coach_stats is security_invoker, so these views are
-- the only anon path, exposing only the listed columns. Supabase's advisor flags
-- owner-rights views; these are intentional. Writes are explicitly revoked because
-- Supabase's default privileges grant ALL on new public relations to anon.

set local lock_timeout = '5s';

create or replace view public.coach_rankings_public with (security_barrier = true) as
select
  s.coach_id, s.display_name, s.slug,
  s.player_count,
  s.men_points, s.women_points, s.total_points,
  rank() over (order by s.total_points desc) as rank_overall,
  rank() over (order by s.men_points desc)   as rank_men,
  rank() over (order by s.women_points desc) as rank_women
from public.coach_stats s
where s.status in ('unreviewed', 'verified') and s.player_count > 0;

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
