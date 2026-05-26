-- supabase/migrations/20260524_suggest_source_flag.sql
-- Public Suggest-a-Source button. OFF in prod, ON in local for dogfood.

INSERT INTO public.feature_flags (key, label, enabled, enabled_local, description)
VALUES (
  'suggest_a_source_button',
  'Suggest a source (public)',
  false,
  true,
  'Renders the "+ Suggest a source" button in the For You end-of-feed state.'
)
ON CONFLICT (key) DO NOTHING;
