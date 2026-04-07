// src/lib/external-id-registry.ts
//
// Unified lookup and registration API for source IDs across all data
// sources. Hides the "hot column vs sidecar" split so callers don't have
// to know where each source lives.
//
// ARCHITECTURE
// - HOT COLUMNS (fast path): top 2 sources have dedicated indexed columns
//   on the main tables.
//     players.padelapi_id      players.fip_id
//     tournaments.padelapi_id  tournaments.fip_id
//     matches.padelapi_id
//   Lookups against these columns are a single query with a unique index.
//
// - SIDECAR (flexible path): every other source goes through the
//   `entity_external_ids` table. Adding a new source = zero schema changes.
//
// The helpers in this file route transparently between the two.
//
// USAGE
// ```
// import { findEntityBySourceId, registerSourceId } from '@/lib/external-id-registry'
//
// // Lookup — works for any source
// const playerId = await findEntityBySourceId(supabase, 'player', 'padelapi', '432')
// const playerId = await findEntityBySourceId(supabase, 'player', 'atp',      'abc-123')
//
// // Register — routes to the right storage
// await registerSourceId(supabase, 'tournament', tournamentId, 'whoscored', 'xyz-42')
// ```

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ──────────────────────────────────────────────────────

export type EntityType = 'player' | 'tournament' | 'match' | 'season'

export type HotSource = 'padelapi' | 'fip'

/** All source names we know about. New sources can be added to this union
 *  as they're integrated (for autocomplete + type safety), but string is
 *  also accepted for flexibility. */
export type KnownSource = HotSource | (string & Record<never, never>)

export interface ExternalIdRegistration {
  entityType: EntityType
  entityId: string
  source: KnownSource
  externalId: string
  metadata?: Record<string, unknown>
}

// ── Hot column mapping ─────────────────────────────────────────
// Maps (entity_type, source) → (table, column) when a hot column exists.
// Anything not in this map goes through the sidecar.

type HotColumnSpec = { table: 'players' | 'tournaments' | 'matches'; column: string }

const HOT_COLUMNS: Record<string, HotColumnSpec | undefined> = {
  'player:padelapi':     { table: 'players',     column: 'padelapi_id' },
  'player:fip':          { table: 'players',     column: 'fip_id' },
  'tournament:padelapi': { table: 'tournaments', column: 'padelapi_id' },
  'tournament:fip':      { table: 'tournaments', column: 'fip_id' },
  'match:padelapi':      { table: 'matches',     column: 'padelapi_id' },
}

export function hasHotColumn(entityType: EntityType, source: string): boolean {
  return HOT_COLUMNS[`${entityType}:${source}`] !== undefined
}

function hotColumnFor(entityType: EntityType, source: string): HotColumnSpec | undefined {
  return HOT_COLUMNS[`${entityType}:${source}`]
}

// ── Lookup ─────────────────────────────────────────────────────

/**
 * Find the canonical entity UUID for a given (source, external ID) pair.
 * Tries the hot column first if one exists for the source, falls back to
 * the sidecar table.
 *
 * Returns null if the external ID is unknown.
 */
export async function findEntityBySourceId(
  supabase: SupabaseClient,
  entityType: EntityType,
  source: string,
  externalId: string
): Promise<string | null> {
  if (!externalId) return null

  // Fast path — hot column lookup
  const hot = hotColumnFor(entityType, source)
  if (hot) {
    const { data, error } = await supabase
      .from(hot.table)
      .select('id')
      .eq(hot.column, externalId)
      .maybeSingle()
    if (error) {
      console.warn(`[external-id-registry] hot lookup failed for ${entityType}:${source}:`, error.message)
    }
    if (data?.id) return data.id as string
    // Fall through to sidecar — maybe it's also registered there (e.g. during
    // a migration when a source is being promoted to a hot column)
  }

  // Sidecar lookup
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('entity_id')
    .eq('entity_type', entityType)
    .eq('source', source)
    .eq('external_id', externalId)
    .maybeSingle()
  if (error) {
    console.warn(`[external-id-registry] sidecar lookup failed for ${entityType}:${source}:`, error.message)
    return null
  }
  return (data?.entity_id as string) ?? null
}

// ── Register ───────────────────────────────────────────────────

/**
 * Register (or update) a source ID for an entity. Routes to the hot column
 * if one exists for the source, otherwise upserts into the sidecar with
 * last_seen_at refreshed.
 *
 * Registering the same (entity_id, source) again updates the external ID
 * in place (rare but possible — e.g. a source re-issues IDs).
 */
export async function registerSourceId(
  supabase: SupabaseClient,
  reg: ExternalIdRegistration
): Promise<void> {
  const { entityType, entityId, source, externalId, metadata } = reg
  if (!externalId) {
    throw new Error(`registerSourceId: externalId is required`)
  }

  const hot = hotColumnFor(entityType, source)
  if (hot) {
    // Hot column write — use direct update on the main table
    const { error } = await supabase
      .from(hot.table)
      .update({ [hot.column]: externalId })
      .eq('id', entityId)
    if (error) {
      throw new Error(`registerSourceId (hot ${entityType}:${source}): ${error.message}`)
    }
    return
  }

  // Sidecar upsert — onConflict by (entity_type, entity_id, source) refreshes
  // the row if it already exists.
  const { error } = await supabase
    .from('entity_external_ids')
    .upsert(
      {
        entity_type: entityType,
        entity_id: entityId,
        source,
        external_id: externalId,
        metadata: metadata ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'entity_type,entity_id,source' }
    )
  if (error) {
    throw new Error(`registerSourceId (sidecar ${entityType}:${source}): ${error.message}`)
  }
}

// ── List all known IDs for an entity ──────────────────────────

export interface SourceIdRecord {
  source: string
  externalId: string
  isHot: boolean
  metadata?: Record<string, unknown>
}

/**
 * List every known (source, external ID) pair for an entity, combining hot
 * columns and sidecar rows. Useful for debug views and data exports.
 */
export async function listSourceIds(
  supabase: SupabaseClient,
  entityType: EntityType,
  entityId: string
): Promise<SourceIdRecord[]> {
  const result: SourceIdRecord[] = []

  // Hot columns: fetch the main row and pick out any populated ID columns
  // for this entity type.
  const hotTable: 'players' | 'tournaments' | 'matches' | null =
    entityType === 'player' ? 'players'
    : entityType === 'tournament' ? 'tournaments'
    : entityType === 'match' ? 'matches'
    : null

  if (hotTable) {
    // Figure out which columns are valid for this entity type by scanning
    // the HOT_COLUMNS map.
    const relevantSources = Object.entries(HOT_COLUMNS)
      .filter(([key, spec]) => key.startsWith(`${entityType}:`) && spec)
      .map(([key, spec]) => ({
        source: key.split(':')[1],
        column: spec!.column,
      }))

    if (relevantSources.length > 0) {
      const cols = ['id', ...relevantSources.map(r => r.column)].join(', ')
      const { data } = await supabase
        .from(hotTable)
        .select(cols)
        .eq('id', entityId)
        .maybeSingle()
      if (data) {
        // Cast via unknown — Supabase's typed response for dynamic select
        // strings doesn't narrow to a concrete shape we can index.
        const row = data as unknown as Record<string, unknown>
        for (const { source, column } of relevantSources) {
          const value = row[column]
          if (typeof value === 'string' && value.length > 0) {
            result.push({ source, externalId: value, isHot: true })
          }
        }
      }
    }
  }

  // Sidecar rows
  const { data: sidecar } = await supabase
    .from('entity_external_ids')
    .select('source, external_id, metadata')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
  for (const row of sidecar ?? []) {
    result.push({
      source: row.source as string,
      externalId: row.external_id as string,
      isHot: false,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
    })
  }

  return result
}
