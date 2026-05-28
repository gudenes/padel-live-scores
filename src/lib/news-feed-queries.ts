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

const SELECT_FIELDS = [
  'id', 'title', 'title_translations', 'source_url', 'source_name', 'source_key',
  'source_icon', 'favicon_url', 'image_url', 'language', 'published_at',
  'snippet', 'summary_md', 'summary_translations', 'tournament_level',
].join(',')

export async function fetchClusteredNews(
  supabase: SupabaseClient,
  opts: FetchNewsOptions = {},
): Promise<ClusteredArticle[]> {
  const limit = opts.limit ?? 50
  const applyDedup = opts.applyDedup !== false

  const { data, error } = await supabase
    .from('articles')
    .select(SELECT_FIELDS)
    .eq('enrichment_status', 'enriched')
    .eq('status', 'active')
    .order('published_at', { ascending: false })
    .limit(limit)

  if (error || !data) {
    console.warn('fetchClusteredNews: supabase error', error)
    return []
  }

  let rows = data as unknown as ArticleRow[]

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
