-- supabase/migrations/20260612120000_home_tournament_spotlight_flag.sql
-- DB-backed feature flag to show/hide the "Tournament Spotlight" hero on the
-- home page, toggleable from the ops Feature Flags tab (no Vercel redeploy).
-- Now that the Live Tournaments carousel covers featured events, the spotlight
-- is redundant — ship it OFF in both prod and local; flip `enabled` from admin
-- to bring it back.
insert into public.feature_flags (key, label, enabled, enabled_local, description)
values (
  'home_tournament_spotlight',
  'Home · Tournament Spotlight hero',
  false,
  false,
  'Shows the featured-tournament spotlight hero (and its heading) on the home page, above Rankings. OFF — the Live Tournaments carousel now covers featured events.'
)
on conflict (key) do nothing;
