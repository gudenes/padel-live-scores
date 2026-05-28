-- supabase/migrations/20260528_home_immersive_flag.sql
-- Home page news rail: when ON, tapping a news card opens For You as an
-- overlay on top of home (no NewsPeekSheet). When OFF, keeps the current
-- NewsPeekSheet flow. Gates the home_news_immersive_link work.

INSERT INTO public.feature_flags (key, label, enabled, enabled_local, description)
VALUES (
  'home_news_immersive_link',
  'Home News → Immersive (overlay)',
  false,
  true,
  'Tap on home news card opens the For You overlay positioned at that article. When off, the legacy NewsPeekSheet preview is shown instead.'
)
ON CONFLICT (key) DO NOTHING;
