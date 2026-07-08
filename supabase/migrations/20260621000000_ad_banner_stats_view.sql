-- supabase/migrations/20260621000000_ad_banner_stats_view.sql
-- All-time per-banner engagement totals for the ops Ads tab.
-- impressions: summed from the ad_impressions daily aggregate.
-- clicks: counted from the ad_clicks per-event table.
-- Keyed by ad_banners.id; sponsor_id in both source tables holds that id as text.
-- Aggregates are cast to int so PostgREST serializes them as JSON numbers (not
-- bigint strings). Safe headroom: ~2.1B all-time events per banner.
-- Aggregates across ALL slots per banner; per-slot breakdown is out of scope.
-- Query as the service role only — the source tables have RLS enabled with no
-- anon policy, so a user/anon-role read returns empty rows.

create or replace view public.ad_banner_stats as
select b.id as banner_id,
       coalesce(i.impressions, 0)::int as impressions,
       coalesce(c.clicks, 0)::int      as clicks
from ad_banners b
left join (
  select sponsor_id, sum(count) as impressions
  from ad_impressions group by sponsor_id
) i on i.sponsor_id = b.id::text
left join (
  select sponsor_id, count(*) as clicks
  from ad_clicks group by sponsor_id
) c on c.sponsor_id = b.id::text;

-- Defense-in-depth: the view is read only via the service role (which bypasses
-- RLS). Revoke the implicit grants so an accidental anon/authenticated read
-- fails loudly instead of silently returning an empty set.
revoke all on public.ad_banner_stats from anon, authenticated;
