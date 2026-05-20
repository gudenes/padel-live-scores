// apps/ops/src/lib/needs-review-counts.ts
// Counts for the Needs Review queue. Phase 1: an approximate duplicate-
// tournament-cluster count based on normalized name + year + level. The
// precise count requires the full dedup clustering algorithm (diacritic
// strip, noise-token filter, token subset match) which lives in
// /api/ops/tournament-dedup in the main app and will land in apps/ops
// when Plan 3 lifts that tab.
//
// Approximate is fine for a sidebar badge — it's a "look at this" hint,
// not an authoritative count. Phase 2 expands the response with
// unresolvedPlayers / oopChanges / streamMapping.

import { pgPool } from './db'

export interface NeedsReviewCounts {
  duplicates: number
  // Phase 2 additions:
  // unresolvedPlayers: number
  // oopChanges: number
  // streamMapping: number
}

export async function getNeedsReviewCounts(): Promise<NeedsReviewCounts> {
  // Count groups of (normalized_name, year, level) with more than one
  // tournament. Approximate vs the canonical dedup; meaningful enough for
  // the badge.
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
  return { duplicates: Number.isFinite(n) ? n : 0 }
}
