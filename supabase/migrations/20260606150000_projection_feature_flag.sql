-- supabase/migrations/20260606150000_projection_feature_flag.sql
-- DB-backed flag for the public Projection feature (Road to Trophy): the
-- Projection tab on tournament pages + the Road-to-trophy card on player
-- profiles. Replaces the NEXT_PUBLIC_PROJECTION_ENABLED env var so it can be
-- toggled from the admin Feature Flags page (separate prod/local switches).
insert into public.feature_flags (key, label, enabled, enabled_local, description)
values (
  'projection_enabled',
  'Projection · Road to Trophy',
  false,
  true,
  'Shows the Projection tab (tournament pages) + Road-to-trophy card (player profiles), Premier-tier only. Needs the tournament-projection-snapshot worker running for data. OFF in prod, ON local for polish.'
)
on conflict (key) do nothing;
