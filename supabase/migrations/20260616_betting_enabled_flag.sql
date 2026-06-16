-- supabase/migrations/20260616_betting_enabled_flag.sql
-- Feature flag for the betting odds / bookmaker referral unit.
-- Ships OFF in production; ON for localhost dev so it can be exercised locally.
-- label is NOT NULL on feature_flags (matches the match_prediction_enabled row shape).
insert into public.feature_flags (key, enabled, enabled_local, label, description)
values (
  'betting_enabled',
  false,
  true,
  'Betting · Bookmaker odds referral',
  'Geo- and age-gated betting odds widget on match detail (enabled markets only, 18+ device gate). OFF in prod.'
)
on conflict (key) do nothing;
