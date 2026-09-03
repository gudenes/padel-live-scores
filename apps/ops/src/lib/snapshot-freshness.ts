// Latest captured_at per tournament for padelgod snapshot tables.
//
// The Tournament Explorer list only needs one timestamp per tournament, but
// these tables are append-only (one row per player/match per scrape). Pulling
// every row via PostgREST + ORDER BY captured_at times out: entry_list is
// ~2M rows, results ~14M. Aggregate in SQL instead.

import { pgPool } from './db'

export const SNAPSHOT_TABLES = [
  'entry_list_snapshots',
  'oop_snapshots',
  'results_snapshots',
  'draw_snapshots',
] as const

export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number]

const ALLOWED = new Set<string>(SNAPSHOT_TABLES)

export function assertSnapshotTable(table: string): asserts table is SnapshotTable {
  if (!ALLOWED.has(table)) {
    throw new Error(`unknown snapshot table: ${table}`)
  }
}

export function emptyFreshnessMaps(): Record<SnapshotTable, Map<string, string>> {
  return {
    entry_list_snapshots: new Map(),
    oop_snapshots: new Map(),
    results_snapshots: new Map(),
    draw_snapshots: new Map(),
  }
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

/** One index lookup per tournament per table. Times out so the explorer list never hangs. */
export async function latestCapturedAtAll(
  tournamentIds: string[],
): Promise<Record<SnapshotTable, Map<string, string>>> {
  const maps = emptyFreshnessMaps()
  if (tournamentIds.length === 0) return maps
  const client = await pgPool().connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL statement_timeout = '5000'")
    const { rows } = await client.query<{ src: SnapshotTable; tournament_id: string; captured_at: Date | string | null }>(
      `
      SELECT src, tournament_id, captured_at FROM (
        SELECT 'entry_list_snapshots'::text AS src, t.id AS tournament_id, s.captured_at
        FROM unnest($1::uuid[]) AS t(id)
        LEFT JOIN LATERAL (
          SELECT captured_at FROM padelgod.entry_list_snapshots
          WHERE tournament_id = t.id ORDER BY captured_at DESC LIMIT 1
        ) s ON true
        UNION ALL
        SELECT 'oop_snapshots', t.id, s.captured_at
        FROM unnest($1::uuid[]) AS t(id)
        LEFT JOIN LATERAL (
          SELECT captured_at FROM padelgod.oop_snapshots
          WHERE tournament_id = t.id ORDER BY captured_at DESC LIMIT 1
        ) s ON true
        UNION ALL
        SELECT 'results_snapshots', t.id, s.captured_at
        FROM unnest($1::uuid[]) AS t(id)
        LEFT JOIN LATERAL (
          SELECT captured_at FROM padelgod.results_snapshots
          WHERE tournament_id = t.id ORDER BY captured_at DESC LIMIT 1
        ) s ON true
        UNION ALL
        SELECT 'draw_snapshots', t.id, s.captured_at
        FROM unnest($1::uuid[]) AS t(id)
        LEFT JOIN LATERAL (
          SELECT captured_at FROM padelgod.draw_snapshots
          WHERE tournament_id = t.id ORDER BY captured_at DESC LIMIT 1
        ) s ON true
      ) x
      WHERE captured_at IS NOT NULL
      `,
      [tournamentIds],
    )
    await client.query('COMMIT')
    for (const r of rows) {
      const ts = iso(r.captured_at)
      if (!ts) continue
      maps[r.src]?.set(r.tournament_id, ts)
    }
    return maps
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* ignore */ }
    console.error('snapshot freshness timed out or failed; returning empty maps', err)
    return emptyFreshnessMaps()
  } finally {
    client.release()
  }
}
