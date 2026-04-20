-- Padelgod Plan 4: partial index to speed up crionet_widget match-id lookups.
-- entity_external_ids already has UNIQUE(source, entity_type, external_id) which covers the raw
-- lookup. This partial index narrows B-tree scans specifically to match rows from the crionet
-- widget source — the hot path called per match per live poll tick.

CREATE INDEX IF NOT EXISTS idx_entity_external_ids_crionet_widget
  ON public.entity_external_ids(external_id)
  WHERE entity_type = 'match' AND source = 'crionet_widget';

DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='idx_entity_external_ids_crionet_widget'),
    'index missing';
END $$;
