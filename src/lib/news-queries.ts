// src/lib/news-queries.ts
// DB query helpers for the public /news pages and the rail.
// All reads go through these so the locale-fallback rule (§7.4 of the spec)
// lives in one place.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { NewsCategory, NewsLocale, NewsPost } from '@/types/news'

function getServerClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
}

const PUBLIC_COLUMNS = 'id,category,locale,slug,title,body_md,cover_image_url,translated_from,status,published_at,created_at,updated_at,model'

/**
 * Merges a list of EN posts with their localized translations so that:
 * - For every EN post that has a translation in `localized`, the localized row replaces the EN row.
 * - EN posts without a translation surface as-is (locale fallback).
 * - Result is sorted by `published_at` descending.
 *
 * Pure function — exported for unit tests.
 */
export function mergeWithFallback(en: NewsPost[], localized: NewsPost[]): NewsPost[] {
  const localizedByEnId = new Map<string, NewsPost>()
  for (const post of localized) {
    if (post.translated_from) localizedByEnId.set(post.translated_from, post)
  }

  const merged: NewsPost[] = []
  for (const enPost of en) {
    merged.push(localizedByEnId.get(enPost.id) ?? enPost)
  }

  return merged.sort((a, b) => {
    const aTime = a.published_at ? Date.parse(a.published_at) : 0
    const bTime = b.published_at ? Date.parse(b.published_at) : 0
    return bTime - aTime
  })
}

/**
 * List published posts for a locale, with EN fallback for untranslated posts.
 * Optional category filter.
 */
export async function listPublished(
  locale: NewsLocale,
  opts: { category?: NewsCategory; limit?: number } = {},
): Promise<NewsPost[]> {
  const supabase = getServerClient()

  if (locale === 'en') {
    let query = supabase
      .from('news_posts')
      .select(PUBLIC_COLUMNS)
      .eq('locale', 'en')
      .eq('status', 'published')
      .order('published_at', { ascending: false })

    if (opts.category) query = query.eq('category', opts.category)
    if (opts.limit) query = query.limit(opts.limit)

    const { data, error } = await query
    if (error) throw error
    return (data as NewsPost[]) ?? []
  }

  let enQuery = supabase
    .from('news_posts')
    .select(PUBLIC_COLUMNS)
    .eq('locale', 'en')
    .eq('status', 'published')
    .order('published_at', { ascending: false })

  let localizedQuery = supabase
    .from('news_posts')
    .select(PUBLIC_COLUMNS)
    .eq('locale', locale)
    .eq('status', 'published')

  if (opts.category) {
    enQuery = enQuery.eq('category', opts.category)
    localizedQuery = localizedQuery.eq('category', opts.category)
  }

  const [enRes, localizedRes] = await Promise.all([enQuery, localizedQuery])
  if (enRes.error) throw enRes.error
  if (localizedRes.error) throw localizedRes.error

  const merged = mergeWithFallback(
    (enRes.data as NewsPost[]) ?? [],
    (localizedRes.data as NewsPost[]) ?? [],
  )

  return opts.limit ? merged.slice(0, opts.limit) : merged
}

/**
 * Get a single post by (locale, slug). If no row exists for that locale/slug,
 * fall back to the EN row with the same slug. Returns null if neither exists.
 */
export async function getBySlug(locale: NewsLocale, slug: string): Promise<NewsPost | null> {
  const supabase = getServerClient()

  const { data: localeRow } = await supabase
    .from('news_posts')
    .select(PUBLIC_COLUMNS)
    .eq('locale', locale)
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()

  if (localeRow) return localeRow as NewsPost

  if (locale !== 'en') {
    const { data: enRow } = await supabase
      .from('news_posts')
      .select(PUBLIC_COLUMNS)
      .eq('locale', 'en')
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle()

    if (enRow) return enRow as NewsPost
  }

  return null
}

/**
 * Get the latest published post (across categories) in the given locale.
 * Used by the rail in /feed.
 */
export async function getLatest(locale: NewsLocale): Promise<NewsPost | null> {
  const posts = await listPublished(locale, { limit: 1 })
  return posts[0] ?? null
}

/**
 * Get up to N "more from PadelNachos" posts in the same category,
 * excluding the given post id.
 */
export async function getRelated(
  locale: NewsLocale,
  category: NewsCategory,
  excludeId: string,
  limit = 4,
): Promise<NewsPost[]> {
  const sameCategory = await listPublished(locale, { category, limit: limit + 1 })
  const filtered = sameCategory.filter(p => p.id !== excludeId).slice(0, limit)

  if (filtered.length >= limit) return filtered

  const all = await listPublished(locale, { limit: limit * 2 })
  const seen = new Set([excludeId, ...filtered.map(p => p.id)])
  for (const p of all) {
    if (filtered.length >= limit) break
    if (!seen.has(p.id)) {
      filtered.push(p)
      seen.add(p.id)
    }
  }
  return filtered
}
