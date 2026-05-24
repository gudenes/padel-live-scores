// apps/ops/src/lib/needs-review-counts.ts
// Counts for the Needs Review sidebar badge. Returns both queues:
//   - duplicates       — approximate tournament-cluster count (existing)
//   - duplicatePlayers — rules-scan groups from @/lib/player-duplicate-rules
//
// The player count runs the rules scan inline (~200-500ms for ~4000 players).
// Acceptable for the 60s sidebar poll. Cache later if measured slow.

import { pgPool } from './db'
import { serviceClient } from './supabase'
import { countDuplicateGroups, type PlayerRow } from './player-duplicate-rules'

export interface NeedsReviewCounts {
  duplicates: number
  duplicatePlayers: number
}

async function getDuplicateTournamentsCount(): Promise<number> {
  const r = await pgPool().query(`
    select count(*)::text as count from (
      select lower(regexp_replace(coalesce(name, ''), '\\s+', ' ', 'g')) as norm_name,
             extract(year from starts_at) as year,
             level
        from public.tournaments
       where starts_at is not null
       group by norm_name, year, level
      having count(*) > 1
    ) clusters
  `)
  const raw = r.rows[0]?.count
  const n = raw == null ? 0 : parseInt(String(raw), 10)
  return Number.isFinite(n) ? n : 0
}

async function getDuplicatePlayersCount(): Promise<number> {
  const supabase = serviceClient()
  // Minimal columns — only what the rules logic reads.
  // PostgREST cap is 10k; we have ~4000 players today.
  const { data, error } = await supabase
    .from('players')
    .select('id, name, country, ranking, points, category, avatar_url, fip_id, external_id')
    .range(0, 9999)
  if (error || !data) return 0
  return countDuplicateGroups(data as PlayerRow[])
}

export async function getNeedsReviewCounts(): Promise<NeedsReviewCounts> {
  const [duplicates, duplicatePlayers] = await Promise.all([
    getDuplicateTournamentsCount(),
    getDuplicatePlayersCount(),
  ])
  return { duplicates, duplicatePlayers }
}
