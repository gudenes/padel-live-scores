-- 20260424000001_backfill_widget_id_entity_external_ids.sql
--
-- Backfill tournament-level `entity_external_ids` rows for every tournament
-- that padelgod has already discovered a widget id for.
--
-- Why: padelgod writes discovered widget ids (e.g. "FIP-2026-1701" for
-- Brussels P2) to `padelgod.widget_id_cache` as the primary store. The ops
-- Tournament Explorer + any future cross-source reconciler resolves the
-- composite `{widget_id}:{match_widget_id}` → public.matches via
-- `public.entity_external_ids` (entity_type='tournament',
-- source='crionet_widget'). Historically we never mirrored widget_id_cache
-- into that sidecar — so the ops page reads `Linked 0 (0%)` for every
-- tournament even though the match-level linkages already exist and
-- correctly point at padelapi-sourced public.matches rows.
--
-- This backfill closes the gap for 125+ tournaments in one pass. Going-
-- forward coverage lives in padelgod's `widget-code-lookup` worker which
-- now writes both sides on discovery (see
-- padelgod/src/workers/widget-code-lookup.ts::syncWidgetIdToEntityExternalIds).
--
-- Idempotent: ON CONFLICT DO NOTHING on the
-- (source, entity_type, external_id) unique constraint. Safe to re-run.

BEGIN;

INSERT INTO public.entity_external_ids (
  entity_type,
  entity_id,
  source,
  external_id,
  first_seen_at,
  last_seen_at
)
SELECT
  'tournament',
  wic.tournament_id,
  'crionet_widget',
  wic.widget_id,
  COALESCE(wic.extracted_at, NOW()),
  COALESCE(wic.last_validated_at, wic.extracted_at, NOW())
FROM padelgod.widget_id_cache wic
WHERE wic.is_active = TRUE
  AND wic.widget_id IS NOT NULL
  -- Only insert rows not already present. The unique constraint would
  -- reject them anyway, but explicit WHERE keeps the RETURNING clean
  -- and avoids ON CONFLICT churn.
  AND NOT EXISTS (
    SELECT 1 FROM public.entity_external_ids eei
    WHERE eei.entity_type = 'tournament'
      AND eei.source = 'crionet_widget'
      AND eei.entity_id = wic.tournament_id
  )
ON CONFLICT (source, entity_type, external_id) DO NOTHING;

COMMIT;
