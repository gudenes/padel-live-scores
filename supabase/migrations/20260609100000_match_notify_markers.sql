-- supabase/migrations/20260609100000_match_notify_markers.sql
-- Per-match notification dedup markers (premium-notifications Plan 2B).
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS scheduled_notified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS result_notified_at    timestamptz NULL;

COMMENT ON COLUMN public.matches.scheduled_notified_at IS 'Set when match_scheduled fired. NULL = not sent.';
COMMENT ON COLUMN public.matches.result_notified_at IS 'Set when title_won/eliminated fired for this finished match. NULL = not sent.';
