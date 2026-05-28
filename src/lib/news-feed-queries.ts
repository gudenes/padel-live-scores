// Shared news article fetcher used by the home rail, For You feed, and any
// other user-facing surface that needs the canonical "enriched + dedup'd"
// view. The admin Articles tab does NOT use this — it has its own fetch
// that intentionally shows the full unfiltered corpus for triage.

import type { SupabaseClient } from '@supabase/supabase-js'
import { clusterArticles } from './feed-scoring'

export interface ArticleRow {
  id: string
  title: string
  title_translations: Record<string, string> | null
  source_url: string
  source_name: string | null
  source_key: string
  source_icon: string | null
  favicon_url: string | null
  image_url: string | null
  language: string | null
  published_at: string
  snippet: string | null
  summary_md: string | null
  summary_translations: Record<string, string>
  tournament_level: string | null
}

export interface ClusteredArticle {
  primary: ArticleRow
  siblings: ArticleRow[]
}

export interface FetchNewsOptions {
  limit?: number
  /** Article UUID to put at the top of the result. Used by deep-link overlay. */
  pinnedFirst?: string
  /** Default true. Pass false to bypass dedup (used by admin triage UIs). */
  applyDedup?: boolean
}

// The DB column is `url`; we alias it to `source_url` (PostgREST syntax) so
// the returned shape matches ForYouArticle. Without this alias, Supabase
// returns an empty result since `source_url` doesn't exist as a column.
//
// NOTE: `tournament_level` is also part of ForYouArticle but does NOT exist
// as a column on `articles` (would cause PostgREST error 42703). The existing
// foryou-queries.ts hard-codes `tournament_level: null` in its mapper — we
// do the same after the fetch.
const SELECT_FIELDS = [
  'id', 'title', 'title_translations', 'source_url:url', 'source_name', 'source_key',
  'source_icon', 'favicon_url', 'image_url', 'language', 'published_at',
  'snippet', 'summary_md', 'summary_translations',
].join(',')

export async function fetchClusteredNews(
  supabase: SupabaseClient,
  opts: FetchNewsOptions = {},
): Promise<ClusteredArticle[]> {
  const limit = opts.limit ?? 50
  const applyDedup = opts.applyDedup !== false

  // Filter out articles without an image_url — the home rail card and the
  // For You hero are both image-led, and an empty <img> tag looks broken.
  // Same filter the legacy home page used before the V2 alignment. About
  // half the enriched corpus has an image today; a future backfill could
  // extract og:image from source pages to raise that ratio.
  const { data, error } = await supabase
    .from('articles')
    .select(SELECT_FIELDS)
    .eq('enrichment_status', 'enriched')
    .eq('status', 'active')
    .not('image_url', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit)

  if (error || !data) {
    console.warn('fetchClusteredNews: supabase error', error)
    return []
  }

  // tournament_level isn't fetched (column doesn't exist on articles);
  // hard-code null so the shape matches ForYouArticle for downstream consumers.
  let rows: ArticleRow[] = (data as unknown as Omit<ArticleRow, 'tournament_level'>[])
    .map(r => ({ ...r, tournament_level: null }))

  // Pinned-first reordering (client-side — small N so cost is negligible).
  if (opts.pinnedFirst) {
    const idx = rows.findIndex(r => r.id === opts.pinnedFirst)
    if (idx > 0) {
      const [pinned] = rows.splice(idx, 1)
      rows = [pinned, ...rows]
    }
  }

  if (!applyDedup) {
    return rows.map(r => ({ primary: r, siblings: [] }))
  }

  return clusterArticles(rows)
}
