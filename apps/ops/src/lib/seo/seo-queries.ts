// apps/ops/src/lib/seo/seo-queries.ts
// Supabase reads for the SEO dashboard. Thin wrappers around pgPool.
// Pages compose these into the rendered output via Server Components.

import { pgPool } from '@/lib/db'
import type { SnapshotRow } from './seo-compute'

export async function getRecentSnapshots(daysBack: number): Promise<SnapshotRow[]> {
  const cutoff = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10)
  const { rows } = await pgPool().query<SnapshotRow>(
    `select day::text as day, locale, clicks, impressions,
            avg_position::float as avg_position,
            ctr::float as ctr
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

// === Opportunities queries ===

export interface LocaleGapRow {
  en_url: string
  en_impressions: number
  es_impressions: number
  pt_impressions: number
  it_impressions: number
  fr_impressions: number
}

/**
 * English pages with ≥100 impressions in the last 30d whose locale variants
 * (built by inserting `/es/`, `/pt/`, `/it/`, `/fr/` after the host) have
 * ≤5% of the English impression count.
 */
export async function getLocaleGaps(limit = 25): Promise<LocaleGapRow[]> {
  const { rows } = await pgPool().query<LocaleGapRow>(
    `
    with last_30d as (
      select url, locale, sum(impressions)::int as impressions
        from public.seo_top_pages
       where day >= current_date - interval '30 days'
       group by url, locale
    ),
    english as (
      select url as en_url, impressions as en_impressions
        from last_30d
       where locale = 'en'
         and impressions >= 100
    )
    select
      e.en_url,
      e.en_impressions,
      coalesce(es.impressions, 0)::int as es_impressions,
      coalesce(pt.impressions, 0)::int as pt_impressions,
      coalesce(it.impressions, 0)::int as it_impressions,
      coalesce(fr.impressions, 0)::int as fr_impressions
    from english e
    left join last_30d es on es.url = regexp_replace(e.en_url, '^(https?://[^/]+)(/.*)?$', '\\1/es\\2') and es.locale = 'es'
    left join last_30d pt on pt.url = regexp_replace(e.en_url, '^(https?://[^/]+)(/.*)?$', '\\1/pt\\2') and pt.locale = 'pt'
    left join last_30d it on it.url = regexp_replace(e.en_url, '^(https?://[^/]+)(/.*)?$', '\\1/it\\2') and it.locale = 'it'
    left join last_30d fr on fr.url = regexp_replace(e.en_url, '^(https?://[^/]+)(/.*)?$', '\\1/fr\\2') and fr.locale = 'fr'
    where (coalesce(es.impressions,0) + coalesce(pt.impressions,0) + coalesce(it.impressions,0) + coalesce(fr.impressions,0))
          <= e.en_impressions * 0.05
    order by e.en_impressions desc
    limit $1
    `,
    [limit],
  )
  return rows
}

export interface InGscNotInSitemapRow {
  url: string
  impressions: number
  position: number | null
}

/** Pages with impressions in last 30d that are NOT in the latest sitemap snapshot. */
export async function getInGscNotInSitemap(limit = 25): Promise<InGscNotInSitemapRow[]> {
  const { rows } = await pgPool().query<InGscNotInSitemapRow>(
    `
    with gsc_30d as (
      select url, sum(impressions)::int as impressions,
             avg(position) as position
        from public.seo_top_pages
       where day >= current_date - interval '30 days'
       group by url
    ),
    latest_sitemap_day as (
      select max(day) as day from public.sitemap_url_snapshot
    )
    select g.url, g.impressions, g.position::float as position
      from gsc_30d g
     where not exists (
       select 1 from public.sitemap_url_snapshot s, latest_sitemap_day l
        where s.day = l.day and s.url = g.url
     )
     order by g.impressions desc
     limit $1
    `,
    [limit],
  )
  return rows
}

export interface InSitemapZeroImpressionsSummary {
  page_type: string
  url_count: number
}

/** URLs in the latest sitemap snapshot with zero impressions in last 30d, grouped by page_type. */
export async function getInSitemapZeroImpressions(): Promise<InSitemapZeroImpressionsSummary[]> {
  const { rows } = await pgPool().query<InSitemapZeroImpressionsSummary>(
    `
    with latest_sitemap_day as (
      select max(day) as day from public.sitemap_url_snapshot
    ),
    sitemap_latest as (
      select s.url, s.page_type
        from public.sitemap_url_snapshot s, latest_sitemap_day l
       where s.day = l.day
    ),
    gsc_30d as (
      select distinct url from public.seo_top_pages
       where day >= current_date - interval '30 days'
    )
    select sl.page_type, count(*)::int as url_count
      from sitemap_latest sl
     where not exists (select 1 from gsc_30d g where g.url = sl.url)
     group by sl.page_type
     order by url_count desc
    `,
  )
  return rows
}

export interface RankCandidateRow {
  url: string
  impressions: number
  position: number
  ctr: number | null
}

/** Pages ranking position 11–30 with > 100 impressions in last 7d. */
export async function getRankCandidates(limit = 20): Promise<RankCandidateRow[]> {
  const { rows } = await pgPool().query<RankCandidateRow>(
    `
    select url,
           sum(impressions)::int as impressions,
           (sum(impressions * position) / nullif(sum(impressions), 0))::float as position,
           (sum(clicks)::float / nullif(sum(impressions), 0))::float as ctr
      from public.seo_top_pages
     where day >= current_date - interval '7 days'
     group by url
    having sum(impressions) > 100
       and (sum(impressions * position) / nullif(sum(impressions), 0)) between 11 and 30
     order by impressions desc
     limit $1
    `,
    [limit],
  )
  return rows
}
