// apps/ops/src/lib/tournament-list-aggregator.ts
//
// Lists tournaments that have an entry-list snapshot in the last 30 days,
// joined with tournament metadata. Used by the Tournament Explorer picker.

import { pgPool } from './db'

export interface TournamentListItem {
  id: string
  name: string
  starts_at: string | null
  ends_at: string | null
  source: string | null
  level: string | null
  country: string | null
  fip_id: string | null
  latestSnapshotAt: string | null
}

export async function getActiveTournamentList(): Promise<TournamentListItem[]> {
  const pool = pgPool()
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const res = await pool.query(
    `with latest_snaps as (
       select tournament_id, max(captured_at) as latest_snapshot_at
         from padelgod.entry_list_snapshots
        where captured_at >= $1
        group by tournament_id
     )
     select t.id, t.name, t.starts_at, t.ends_at, t.source, t.level, t.country, t.fip_id,
            ls.latest_snapshot_at
       from public.tournaments t
       join latest_snaps ls on ls.tournament_id = t.id
       order by t.starts_at desc nulls last`,
    [cutoff],
  )
  // `pg` parses `timestamptz` columns into JS `Date` objects by default —
  // raw row values for starts_at / ends_at / latest_snapshot_at are Date
  // instances at runtime, not strings. Normalize to ISO 8601 here so the
  // exported `TournamentListItem` shape matches its declared `string | null`
  // type and consumers can call `.slice(0, 10)` for the date prefix.
  type TournamentRow = {
    id: string; name: string; starts_at: Date | string | null; ends_at: Date | string | null
    source: string | null; level: string | null; country: string | null
    fip_id: string | null; latest_snapshot_at: Date | string | null
  }
  const toIso = (v: Date | string | null): string | null =>
    v == null ? null : v instanceof Date ? v.toISOString() : v
  return (res.rows as TournamentRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    starts_at: toIso(r.starts_at),
    ends_at: toIso(r.ends_at),
    source: r.source,
    level: r.level,
    country: r.country,
    fip_id: r.fip_id,
    latestSnapshotAt: toIso(r.latest_snapshot_at),
  }))
}
