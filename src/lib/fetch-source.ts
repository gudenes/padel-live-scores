// src/lib/fetch-source.ts — shared per-source RSS fetch + article upsert.
// Used by the weekly dynamic-source cron. The static-source cron (sync-articles)
// has its own richer pipeline (og:meta enrichment, title translation) and
// doesn't share this helper — V1 keeps the two paths separate.

import type { SupabaseClient } from '@supabase/supabase-js'
import Parser from 'rss-parser'
import GoogleNewsDecoder from 'google-news-decoder'

export interface SourceRow {
  key: string
  name: string
  url: string
  source_type: 'rss' | 'wp-api' | 'google-news-search'
  language: string
  weight: number
  lookback_days: number
}

export interface FetchResult {
  added: number
  error: string | null
}

const parser = new Parser({ timeout: 15000 })

export async function fetchAndUpsertSource(
  supabase: SupabaseClient,
  source: SourceRow,
): Promise<FetchResult> {
  try {
    if (source.source_type === 'wp-api') {
      // wp-api branch — handled in sync-articles route directly.
      // Dynamic sources never use wp-api (they're all google-news-search).
      return { added: 0, error: 'wp-api not supported in dynamic fetcher' }
    }
    const feed = await parser.parseURL(source.url)
    const cutoff = Date.now() - source.lookback_days * 86400_000
    let added = 0
    for (const item of feed.items) {
      const pub = item.pubDate ? Date.parse(item.pubDate) : Date.now()
      if (pub < cutoff) continue
      const realUrl = await resolveGoogleNewsUrlIfNeeded(item.link ?? '')
      if (!realUrl) continue
      const { error } = await supabase.from('articles').upsert({
        url: realUrl,
        title: item.title ?? '(untitled)',
        source_name: source.name,
        source_weight: source.weight,
        published_at: new Date(pub).toISOString(),
        language: source.language,
        favicon_url: deriveFavicon(realUrl),
        enrichment_status: 'pending',
      }, { onConflict: 'url' })
      if (!error) added++
    }
    return { added, error: null }
  } catch (e) {
    return { added: 0, error: (e as Error).message.slice(0, 500) }
  }
}

async function resolveGoogleNewsUrlIfNeeded(url: string): Promise<string | null> {
  if (!url.includes('news.google.com')) return url
  try {
    const decoder = new GoogleNewsDecoder()
    const result = await decoder.decodeGoogleNewsUrl(url)
    return result?.decodedUrl ?? null
  } catch { return null }
}

function deriveFavicon(url: string): string | null {
  try {
    const u = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`
  } catch { return null }
}
