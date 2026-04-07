-- Entity external IDs sidecar table — Phase 3 of data-model cleanup.
--
-- GOAL
-- Provide a flexible home for source IDs from NEW data sources without
-- requiring a schema change every time a source is added. The current hot
-- columns (players.padelapi_id, players.fip_id, tournaments.padelapi_id,
-- tournaments.fip_id, matches.padelapi_id) stay where they are — they're
-- fast-path for the top 2 sources. This sidecar handles everything else.
--
-- ARCHITECTURE: "hot columns + sidecar"
-- - Top 2 sources (padelapi, fip) live as indexed columns on the main tables
-- - Every other source goes through entity_external_ids
-- - The external-id-registry helper (src/lib/external-id-registry.ts)
--   transparently routes lookups: hot columns first, then sidecar.
--
-- POLYMORPHIC DESIGN
-- entity_type + entity_id is polymorphic (can point to players, tournaments,
-- matches, or seasons). We intentionally don't add a FK — Postgres doesn't
-- support polymorphic FKs cleanly and the orphan-cleanup cost is low
-- (parent rows are rarely deleted in this app). If we ever need strict
-- referential integrity, we can split into 4 typed tables in a later
-- migration.

BEGIN;

CREATE TABLE IF NOT EXISTS entity_external_ids (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('player', 'tournament', 'match', 'season')),
  entity_id     UUID NOT NULL,
  source        TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  metadata      JSONB,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Each (source, entity_type, external_id) triple identifies one unique
  -- entity — two different entities can't share an ID within the same
  -- source. This is the "reverse lookup" uniqueness.
  CONSTRAINT entity_external_ids_source_external_uk
    UNIQUE (source, entity_type, external_id),

  -- One source has at most one ID per entity. We don't keep historical IDs
  -- (yet). If an entity's ID changes in a source, we overwrite in place.
  CONSTRAINT entity_external_ids_entity_source_uk
    UNIQUE (entity_type, entity_id, source)
);

-- Fast "what are all the external IDs for this entity" lookups (used by UI
-- debug views, data exports, merge tools).
CREATE INDEX IF NOT EXISTS entity_external_ids_entity_idx
  ON entity_external_ids (entity_type, entity_id);

-- Fast "which entity is this external ID?" lookups (the hot path for sync
-- jobs). The unique constraint already creates a usable index, but having
-- an explicit one documents intent.
CREATE INDEX IF NOT EXISTS entity_external_ids_source_lookup_idx
  ON entity_external_ids (source, external_id);

COMMENT ON TABLE  entity_external_ids IS 'Sidecar for source IDs from sources beyond the top 2 (padelapi, fip). Those two live as hot columns on the main tables for speed.';
COMMENT ON COLUMN entity_external_ids.entity_type IS 'player | tournament | match | season';
COMMENT ON COLUMN entity_external_ids.source      IS 'Data source identifier (e.g. "atp", "whoscored", "matchscorer")';
COMMENT ON COLUMN entity_external_ids.external_id IS 'The ID as known to the source';
COMMENT ON COLUMN entity_external_ids.metadata    IS 'Optional source-specific metadata (API URL, scraper state, etc.)';

COMMIT;
