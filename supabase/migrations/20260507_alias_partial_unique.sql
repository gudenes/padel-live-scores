-- Allow many aliases per (entity, 'alias') so we can accumulate name
-- variants over time as PlayerResolver discovers new spellings.
--
-- BACKGROUND
-- The original entity_external_ids_entity_source_uk constraint enforced
-- "one source has at most one ID per entity." That's correct for
-- structured sources like padelapi/fip/whoscored where each player has
-- exactly one ID. But the 'alias' source is a name-variant cache, and
-- we want it to GROW: every time we resolve a new spelling of a known
-- player, we want to remember it so the next lookup is instant.
--
-- WHY IT MATTERS
-- During the slug-style padelapi_id incident (838 duplicate players
-- created 2026-03/04 because PlayerResolver's fuzzy match couldn't
-- bridge "Marta Borrero" ↔ "Marta Borrero Fernandez De La Puente"),
-- we found that a single alias row per player isn't enough. The
-- cleanup script merges variants into canonical and registers each
-- merged variant as an alias — that requires multiple alias rows per
-- player.
--
-- RULE PRESERVED FOR EVERY OTHER SOURCE
-- Replacement is a partial unique index that EXCLUDES the 'alias'
-- source. padelapi/fip/whoscored/etc still get the "one ID per entity
-- per source" guarantee.

BEGIN;

ALTER TABLE entity_external_ids
  DROP CONSTRAINT IF EXISTS entity_external_ids_entity_source_uk;

CREATE UNIQUE INDEX IF NOT EXISTS entity_external_ids_entity_source_nonalias_uk
  ON entity_external_ids (entity_type, entity_id, source)
  WHERE source <> 'alias';

COMMENT ON INDEX entity_external_ids_entity_source_nonalias_uk IS
  'One ID per (entity, non-alias source). The alias source is a multi-row name-variant cache and is intentionally excluded.';

COMMIT;
