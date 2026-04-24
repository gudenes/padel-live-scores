-- Add `widget_id_composite` to public.matches — the canonical identity
-- column for the simplified pipeline (see
-- docs/superpowers/specs/2026-04-24-simplified-pipeline-architecture.md).
--
-- Format: "{tournament_widget_id}:{match_widget_id}"
--   example: "FIP-2026-1706:MD017"
--
-- Every source (FIP event-page draw, Crionet OOP widget, Crionet results
-- widget, Crionet live widget) emits the same match-level widget id. Once
-- combined with the tournament's widget code, the composite is a globally
-- unique identifier — no name resolution, no synthetic fallbacks, no
-- `findOrCreateMatch` escape hatches.
--
-- NULL during migration: existing matches created by the old
-- static-reconciler with synthetic composites
-- ("draw:men:main_draw:R32:8") stay with this column NULL. Going
-- forward, every match created by `fip-draw-populator` has it set.
-- At Step 6 of the migration (after the new writers prove themselves
-- for ~1 week), a cleanup script deletes duplicate old-style rows.
--
-- Partial UNIQUE index enforces "at most one match per composite"
-- without blocking legacy NULL rows. Prevents race-condition duplicates
-- when two populator invocations try to INSERT the same match in
-- parallel (the second loses to the first via constraint violation
-- → populator treats that as "already exists, UPDATE or skip").

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS widget_id_composite TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS matches_widget_id_composite_key
  ON public.matches (widget_id_composite)
  WHERE widget_id_composite IS NOT NULL;

COMMENT ON COLUMN public.matches.widget_id_composite IS
  'Canonical match identity for the simplified pipeline: '
  '"{tournament_widget_id}:{match_widget_id}" (e.g. "FIP-2026-1706:MD017"). '
  'Populated by fip-draw-populator worker on INSERT. NULL on legacy rows '
  'created by the pre-2026-04-24 static-reconciler (those used a synthetic '
  'composite stored only in entity_external_ids). See the 2026-04-24 '
  'simplified-pipeline-architecture design doc for the full rationale.';
