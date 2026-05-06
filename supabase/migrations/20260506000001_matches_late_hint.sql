-- supabase/migrations/20260506000001_matches_late_hint.sql
--
-- Adds late_hint column to public.matches. Populated by padelgod's
-- schedule-hints-writer every 2 min based on the court chain state.
-- See docs/superpowers/specs/2026-05-06-schedule-late-flags-design.md
-- for the rules.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS late_hint TEXT NULL;

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_late_hint_check;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_late_hint_check
    CHECK (late_hint IS NULL OR late_hint IN ('may_be_late', 'starting_soon'));

CREATE INDEX IF NOT EXISTS idx_matches_late_hint
  ON public.matches (late_hint)
  WHERE late_hint IS NOT NULL;

COMMENT ON COLUMN public.matches.late_hint IS
  'Computed schedule hint for the matches list UI. ''may_be_late'' = the previous match on this court is running over expected duration or is itself delayed. ''starting_soon'' = the previous match has finished, this match is the immediate next still scheduled. NULL = no hint to render. Written by padelgod schedule-hints-writer worker every ~2 min. Cleared when the match leaves scheduled status.';
