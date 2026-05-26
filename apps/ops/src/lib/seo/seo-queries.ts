// apps/ops/src/lib/seo/seo-queries.ts
// Supabase reads for the SEO dashboard. Thin wrappers around pgPool.
// Pages compose these into the rendered output via Server Components.

import { pgPool } from '@/lib/db'
import type { SnapshotRow } from './seo-compute'

export async function getRecentSnapshots(daysBack: number): Promise<SnapshotRow[]> {
  const cutoff = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10)
  const { rows } = await pgPool().query<SnapshotRow>(
    `select day::text as day, locale, clicks, impressions, avg_position, ctr
       from public.seo_snapshots
      where day >= $1
      order by day asc, locale asc`,
    [cutoff],
  )
  return rows
}

export async function getLatestIngestDay(): Promise<{ day: string; fetched_at: string } | null> {
  const { rows } = await pgPool().query<{ day: string; fetched_at: string }>(
    `select day::text as day, fetched_at::text as fetched_at
       from public.seo_snapshots
      where locale = 'total'
      order by day desc
      limit 1`,
  )
  return rows[0] ?? null
}

export interface TopQuery {
  rank: number
  query: string
  clicks: number
  impressions: number
  position: number | null
}

export async function getTopQueries(day: string, limit = 20): Promise<TopQuery[]> {
  const { rows } = await pgPool().query<TopQuery>(
    `select rank, query, clicks, impressions, position::float as position
       from public.seo_top_queries
      where day = $1
      order by rank
      limit $2`,
    [day, limit],
  )
  return rows
}
