-- supabase/migrations/20260612100000_match_prediction_flag.sql
-- DB-backed feature flag for the match prediction + fan-vote feature, so it can
-- be toggled from the ops Feature Flags tab (no Vercel redeploy). Replaces the
-- old NEXT_PUBLIC_MATCH_PREDICTION_ENABLED env var. OFF in prod, ON local for
-- polish — flip `enabled` from admin to launch.
insert into public.feature_flags (key, label, enabled, enabled_local, description)
values (
  'match_prediction_enabled',
  'Match · PadelNacho Predictor + vote',
  false,
  true,
  'Shows the Elo win-probability prediction + one-tap community vote on match cards and the match page (replaces the hidden Guacas margin-pick UI). OFF in prod.'
)
on conflict (key) do nothing;
