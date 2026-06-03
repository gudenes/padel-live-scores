-- Presence helper for the Data Readiness ops view.
--
-- The view needs, per tournament, a set of boolean "do we have ANY row of
-- this kind" flags across several large, append-only tables (padelgod
-- snapshot tables have thousands of rows per tournament). Doing this from
-- the app by fetching rows and de-duping overflows PostgREST's 10k-row cap
-- and silently drops snapshot-heavy tournaments (e.g. FIP Bronze Ijuí, with
-- ~10k snapshot rows), which is exactly the "scraped but not populated"
-- case the view must catch. Each flag here is an indexed EXISTS — cap-immune,
-- one row per input id, and fast.
--
-- `has_stats` joins match_stats → matches to attribute stats to a tournament
-- (match_stats is keyed by match_id, not tournament_id).

create or replace function readiness_presence(ids uuid[])
returns table (
  tournament_id uuid,
  has_draw_snap boolean,
  has_oop_snap boolean,
  has_results_snap boolean,
  has_entry_snap boolean,
  has_draws boolean,
  has_streams boolean,
  has_stats boolean
)
language sql
stable
as $$
  select
    t as tournament_id,
    exists(select 1 from padelgod.draw_snapshots d        where d.tournament_id  = t),
    exists(select 1 from padelgod.oop_snapshots o         where o.tournament_id  = t),
    exists(select 1 from padelgod.results_snapshots r     where r.tournament_id  = t),
    exists(select 1 from padelgod.entry_list_snapshots e  where e.tournament_id  = t),
    exists(select 1 from public.tournament_draws td       where td.tournament_id = t),
    exists(select 1 from public.fip_court_streams s       where s.tournament_id  = t),
    exists(
      select 1 from public.match_stats ms
      join public.matches m on m.id = ms.match_id
      where m.tournament_id = t
    )
  from unnest(ids) as t
$$;
