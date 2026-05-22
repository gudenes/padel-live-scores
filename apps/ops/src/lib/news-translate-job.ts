// apps/ops/src/lib/news-translate-job.ts
// Orchestrates translation of a published EN news post to ES/PT/IT/FR.
// Slug stickiness: existing translation rows keep their slugs; only
// title/body_md are overwritten. New translations get whatever Haiku
// returns for the slug.

import { serviceClient } from '@/lib/supabase'
import { translateNews, type SupportedLocale } from './news-translator'
import { generateSlug } from './news-slug'
import type { NewsPost, NewsLocale } from '@/types/news'

const TARGET_LOCALES: SupportedLocale[] = ['es', 'pt', 'it', 'fr']

export interface TranslateAndStoreResult {
  succeeded: SupportedLocale[]
  failed: { locale: SupportedLocale; error: string }[]
}

/**
 * Translate the given EN post into all 4 target locales in parallel.
 * Returns successful + failed locales — the caller may surface failures
 * but should NOT consider the publish itself failed.
 */
export async function translateAndStore(enPost: NewsPost): Promise<TranslateAndStoreResult> {
  if (enPost.locale !== 'en') {
    throw new Error('[translateAndStore] expected an EN post')
  }

  const results = await Promise.allSettled(
    TARGET_LOCALES.map((locale) => translateOne(enPost, locale)),
  )

  const succeeded: SupportedLocale[] = []
  const failed: { locale: SupportedLocale; error: string }[] = []

  results.forEach((r, idx) => {
    const locale = TARGET_LOCALES[idx]
    if (r.status === 'fulfilled') {
      succeeded.push(locale)
    } else {
      failed.push({ locale, error: (r.reason as Error).message })
      console.error(`[translateAndStore] ${locale} failed:`, (r.reason as Error).message)
    }
  })

  return { succeeded, failed }
}

/** Translate exactly one (en, locale) pair and upsert the row. */
async function translateOne(enPost: NewsPost, locale: SupportedLocale): Promise<void> {
  const supabase = serviceClient()

  const { output } = await translateNews(
    { title: enPost.title, body_md: enPost.body_md, slug: enPost.slug },
    locale,
  )

  // Slug stickiness: if a row already exists for this (en post, locale),
  // keep its slug; only overwrite title + body_md.
  const { data: existing } = await supabase
    .from('news_posts')
    .select('id, slug')
    .eq('translated_from', enPost.id)
    .eq('locale', locale)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('news_posts')
      .update({
        title: output.title,
        body_md: output.body_md,
        category: enPost.category,
        status: enPost.status,
        published_at: enPost.published_at,
        cover_image_url: enPost.cover_image_url,
        model: 'claude-haiku-4-5',
      })
      .eq('id', existing.id)
    if (error) throw error
    return
  }

  const sanitizedSlug = generateSlug(output.slug) || generateSlug(output.title)
  const finalSlug = await ensureUniqueSlug(supabase, locale, sanitizedSlug)

  const { error } = await supabase.from('news_posts').insert({
    category: enPost.category,
    locale,
    slug: finalSlug,
    title: output.title,
    body_md: output.body_md,
    cover_image_url: enPost.cover_image_url,
    translated_from: enPost.id,
    status: enPost.status,
    published_at: enPost.published_at,
    model: 'claude-haiku-4-5',
  })

  if (error) throw error
}

async function ensureUniqueSlug(
  supabase: ReturnType<typeof serviceClient>,
  locale: NewsLocale,
  baseSlug: string,
): Promise<string> {
  let candidate = baseSlug
  let n = 1
  while (n < 50) {
    const { data } = await supabase
      .from('news_posts')
      .select('id')
      .eq('locale', locale)
      .eq('slug', candidate)
      .maybeSingle()
    if (!data) return candidate
    n += 1
    candidate = `${baseSlug}-${n}`
  }
  throw new Error(`[ensureUniqueSlug] could not find unique slug after 50 tries for ${baseSlug}`)
}

/** Re-translate just one locale for a given EN post. Used by the retry endpoint. */
export async function translateOneLocale(enPostId: string, locale: SupportedLocale): Promise<void> {
  const supabase = serviceClient()
  const { data: enPost, error } = await supabase
    .from('news_posts')
    .select('*')
    .eq('id', enPostId)
    .eq('locale', 'en')
    .single()

  if (error || !enPost) {
    throw new Error(`[translateOneLocale] EN post ${enPostId} not found`)
  }

  await translateOne(enPost as NewsPost, locale)
}
