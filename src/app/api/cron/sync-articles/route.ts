// src/app/api/cron/sync-articles/route.ts
// Fetches padel news from RSS feeds + FIP WordPress API, upserts into articles table.
// Runs every 6 hours via Vercel cron.

import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase'
import Parser from 'rss-parser'
import GoogleNewsDecoder from 'google-news-decoder'
import { logOpsEvent } from '@/lib/ops-logger'
import { translateTitleBundle } from '@/lib/snippet-translator'

// Bumped from 60→120s to absorb title-translation calls. Each new
// article costs one Claude Haiku call (~2s); typical hourly run has
// 10-30 new articles, so worst case ~60s of translations on top of
// the ~20s fetch+enrich path.
export const maxDuration = 120

// ── Source definitions ──────────────────────────────────────────────────────

interface ArticleSource {
  key: string
  name: string
  icon: string
  language: string
  weight: number
  type: 'rss' | 'wp-api'
  url: string
  /** How far back to ingest articles for this source. Defaults to 14 days.
   *  Niche / low-volume sources (e.g. Olympic-track padel news) widen this
   *  so the BeatsFeed has enough signal to look alive. */
  lookbackDays?: number
}

const SOURCES: ArticleSource[] = [
  // Google News — multi-language padel coverage
  {
    key: 'google-news-en', name: 'Google News', icon: 'G', language: 'en', weight: 1.0,
    type: 'rss', url: 'https://news.google.com/rss/search?q=padel+premier+padel&hl=en&gl=US&ceid=US:en',
  },
  {
    key: 'google-news-es', name: 'Google News', icon: 'G', language: 'es', weight: 1.0,
    type: 'rss', url: 'https://news.google.com/rss/search?q=padel+premier+padel&hl=es&gl=ES&ceid=ES:es',
  },
  {
    key: 'google-news-pt', name: 'Google News', icon: 'G', language: 'pt', weight: 1.0,
    type: 'rss', url: 'https://news.google.com/rss/search?q=padel+premier+padel&hl=pt-PT&gl=PT&ceid=PT:pt-150',
  },
  {
    key: 'google-news-br', name: 'Google News', icon: 'G', language: 'pt', weight: 1.0,
    type: 'rss', url: 'https://news.google.com/rss/search?q=padel+premier+padel&hl=pt-BR&gl=BR&ceid=BR:pt-419',
  },
  // Olympic-track padel news for /road-to-olympics BeatsFeed.
  // Google News doesn't honor compound OR queries, so we run two simple
  // single-keyword feeds and let the BeatsFeed regex (in src/lib/road-to-
  // olympics/beats.ts) do the rest of the filtering.
  {
    key: 'google-news-olympics-en', name: 'Google News', icon: 'G', language: 'en', weight: 1.0,
    type: 'rss', url: 'https://news.google.com/rss/search?q=padel+olympic&hl=en-US&gl=US&ceid=US:en',
    lookbackDays: 90,
  },
  {
    key: 'google-news-ioc-en', name: 'Google News', icon: 'G', language: 'en', weight: 1.0,
    type: 'rss', url: 'https://news.google.com/rss/search?q=padel+ioc&hl=en-US&gl=US&ceid=US:en',
    lookbackDays: 90,
  },
  // Dedicated padel sites
  {
    key: 'padel-addict', name: 'Padel Addict', icon: 'PA', language: 'es', weight: 1.2,
    type: 'rss', url: 'https://padeladdict.com/feed/',
  },
  {
    key: 'padel-magazine', name: 'Padel Magazine', icon: 'PM', language: 'fr', weight: 1.2,
    type: 'rss', url: 'https://padelmagazine.fr/feed/',
  },
  // FIP official — WordPress REST API
  {
    key: 'fip', name: 'FIP', icon: 'FIP', language: 'en', weight: 1.5,
    type: 'wp-api', url: 'https://www.padelfip.com/wp-json/wp/v2/posts?per_page=15&_embed=wp:featuredmedia',
  },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

// Strip HTML tags from excerpt
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

// Decode HTML character entities in a URL-like string. Some RSS feeds (cope.es
// notably) emit URLs with hex/decimal entities for : and / which then break
// when rendered as <img src>. This decoder normalizes them and validates that
// the result is a real http(s) URL — anything else returns null.
function sanitizeImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const decoded = raw
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
  if (!/^https?:\/\//i.test(decoded)) return null
  return decoded
}

// Truncate snippet to ~200 chars at word boundary
function truncate(text: string, max = 200): string {
  if (text.length <= max) return text
  const cut = text.substring(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.substring(0, lastSpace) : cut) + '...'
}

// Extract first image URL from HTML content (for RSS items without dedicated image)
function extractImage(html: string): string | null {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/)
  return match ? match[1] : null
}

// Extract domain from URL for favicon lookup
function getDomain(url: string): string | null {
  try { return new URL(url).hostname } catch { return null }
}

// Google's public favicon service — returns a 32px icon for any domain
function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?sz=64&domain=${domain}`
}

// Google News titles embed the real source after the last " - "
// e.g. "Galán conquista Miami - Estrella Digital" → "Estrella Digital"
function extractRealSource(title: string, fallback: string): string {
  const sep = title.lastIndexOf(' - ')
  if (sep > 0 && sep < title.length - 3) {
    const candidate = title.substring(sep + 3).trim()
    // Sanity: source name should be short-ish and not look like a sentence
    if (candidate.length > 0 && candidate.length < 60 && !candidate.includes('. ')) {
      return candidate
    }
  }
  return fallback
}

// Fetch og:image and og:description from a URL by downloading the HTML head.
// Follows redirects (important for Google News URLs). Timeout 5s per article.
async function fetchOgMeta(url: string): Promise<{ image: string | null; description: string | null; realUrl: string | null }> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PadelNachos/1.0 (+https://padelnachos.com)' },
      redirect: 'follow',
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return { image: null, description: null, realUrl: null }
    const realUrl = res.url !== url ? res.url : null
    const reader = res.body?.getReader()
    if (!reader) return { image: null, description: null, realUrl }
    let html = ''
    while (html.length < 50000) {
      const { done, value } = await reader.read()
      if (done) break
      html += new TextDecoder().decode(value)
      if (html.includes('</head>')) break
    }
    reader.cancel().catch(() => {})
    const imgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/)
    const descMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/)
      || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/)
    return {
      image: imgMatch ? imgMatch[1] : null,
      description: descMatch ? truncate(stripHtml(descMatch[1]), 200) : null,
      realUrl,
    }
  } catch {
    return { image: null, description: null, realUrl: null }
  }
}

// Legacy wrapper
async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PadelNachos/1.0 (+https://padelnachos.com)' },
      redirect: 'follow',
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    // Only read first 50KB to find og:image (it's always in <head>)
    const reader = res.body?.getReader()
    if (!reader) return null
    let html = ''
    while (html.length < 50000) {
      const { done, value } = await reader.read()
      if (done) break
      html += new TextDecoder().decode(value)
      // Check if we've passed </head> — no need to read further
      if (html.includes('</head>')) break
    }
    reader.cancel().catch(() => {})
    const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

interface ArticleRow {
  title: string
  source_name: string
  source_icon: string
  source_key: string
  url: string
  image_url: string | null
  snippet: string | null
  language: string
  published_at: string
  source_weight: number
  updated_at: string
  favicon_url: string | null
}

// ── RSS fetcher ─────────────────────────────────────────────────────────────

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'PadelNachos/1.0 (+https://padelnachos.com)' },
})

// For Google News feeds: fetch raw XML and extract <source url="...">name</source>
// mapping so we can get the real publisher domain for favicons.
// Returns a Map of source name → source URL (e.g. "MARCA" → "https://www.marca.com")
async function fetchGoogleNewsSourceMap(feedUrl: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const res = await fetch(feedUrl, {
      headers: { 'User-Agent': 'PadelNachos/1.0 (+https://padelnachos.com)' },
    })
    if (!res.ok) return map
    const xml = await res.text()
    const matches = xml.matchAll(/<source\s+url="([^"]+)"[^>]*>([^<]+)<\/source>/gi)
    for (const m of matches) {
      map.set(m[2].trim(), m[1].trim())
    }
  } catch { /* ignore */ }
  return map
}

async function fetchRSS(source: ArticleSource): Promise<ArticleRow[]> {
  const isGoogleNews = source.key.startsWith('google-news')

  // For Google News: fetch the raw XML in parallel to get source URLs
  const [feed, sourceMap] = await Promise.all([
    parser.parseURL(source.url),
    isGoogleNews ? fetchGoogleNewsSourceMap(source.url) : Promise.resolve(new Map<string, string>()),
  ])

  const cutoff = Date.now() - (source.lookbackDays ?? 14) * 86400000
  const rows: ArticleRow[] = []

  for (const item of (feed.items ?? []).slice(0, 20)) {
    if (!item.title || !item.link) continue
    const pubDate = item.pubDate ? new Date(item.pubDate) : null
    if (!pubDate || pubDate.getTime() < cutoff) continue

    // Try to find an image
    let imageUrl: string | null = null
    if (item.enclosure?.url) {
      imageUrl = item.enclosure.url
    } else if (item['content:encoded']) {
      imageUrl = extractImage(item['content:encoded'] as string)
    } else if (item.content) {
      imageUrl = extractImage(item.content)
    }

    const snippet = item.contentSnippet
      ? truncate(item.contentSnippet)
      : item.content
        ? truncate(stripHtml(item.content))
        : null

    // For Google News: extract the real source from the title and resolve favicon from source URL
    const rawTitle = stripHtml(item.title)
    const realSource = isGoogleNews ? extractRealSource(rawTitle, source.name) : source.name
    // Strip the source suffix from Google News titles ("Title - Source" → "Title")
    const cleanTitle = isGoogleNews && rawTitle.lastIndexOf(' - ') > 0
      ? rawTitle.substring(0, rawTitle.lastIndexOf(' - ')).trim()
      : rawTitle

    // Resolve favicon: for Google News use the real publisher domain from <source url="...">,
    // otherwise fall back to the link domain
    let iconDomain: string | null = null
    if (isGoogleNews) {
      const publisherUrl = sourceMap.get(realSource)
      if (publisherUrl) iconDomain = getDomain(publisherUrl)
    }
    if (!iconDomain) iconDomain = getDomain(item.link)
    const iconUrl = iconDomain ? faviconUrl(iconDomain) : null

    rows.push({
      title: cleanTitle,
      source_name: realSource,
      source_icon: iconUrl ?? source.icon,
      source_key: source.key,
      url: item.link,
      image_url: sanitizeImageUrl(imageUrl),
      snippet,
      language: source.language,
      published_at: pubDate.toISOString(),
      source_weight: source.weight,
      updated_at: new Date().toISOString(),
      favicon_url: iconUrl,
    })
  }

  return rows
}

// ── FIP WordPress API fetcher ───────────────────────────────────────────────

interface WPPost {
  id: number
  date: string
  link: string
  title: { rendered: string }
  excerpt: { rendered: string }
  _embedded?: {
    'wp:featuredmedia'?: Array<{ source_url?: string }>
  }
}

async function fetchFIP(source: ArticleSource): Promise<ArticleRow[]> {
  const res = await fetch(source.url, {
    headers: { 'User-Agent': 'PadelNachos/1.0 (+https://padelnachos.com)' },
  })
  if (!res.ok) throw new Error(`FIP API ${res.status}: ${await res.text()}`)
  const posts = (await res.json()) as WPPost[]
  const rows: ArticleRow[] = []

  for (const post of posts) {
    const imageUrl = post._embedded?.['wp:featuredmedia']?.[0]?.source_url ?? null

    const domain = getDomain(post.link)
    const iconUrl = domain ? faviconUrl(domain) : null

    rows.push({
      title: stripHtml(post.title.rendered),
      source_name: source.name,
      source_icon: iconUrl ?? source.icon,
      source_key: source.key,
      url: post.link,
      image_url: sanitizeImageUrl(imageUrl),
      snippet: truncate(stripHtml(post.excerpt.rendered)),
      language: source.language,
      published_at: new Date(post.date).toISOString(),
      source_weight: source.weight,
      updated_at: new Date().toISOString(),
      favicon_url: iconUrl,
    })
  }

  return rows
}

// ── Main handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const meta = await logOpsEvent('cron:articles', async () => {
      const supabase = createServerClient()
      const results: Record<string, { fetched: number; error?: string }> = {}
      let totalUpserted = 0

      for (const source of SOURCES) {
        try {
          const rows = source.type === 'wp-api'
            ? await fetchFIP(source)
            : await fetchRSS(source)

          results[source.key] = { fetched: rows.length }

          if (rows.length === 0) continue

          // Enrich articles — resolve real URLs for Google News, fetch og:image & og:description.
          // Process up to 10 at a time to stay within the 60s timeout.
          const isGNews = source.key.startsWith('google-news')
          const needEnrich = rows.filter(r => !r.image_url || isGNews).slice(0, 10)
          if (needEnrich.length > 0) {
            // For Google News: first decode the real article URLs
            if (isGNews) {
              const decoder = new GoogleNewsDecoder()
              const decodeResults = await Promise.allSettled(
                needEnrich.map(r => decoder.decodeGoogleNewsUrl(r.url))
              )
              for (let i = 0; i < needEnrich.length; i++) {
                const result = decodeResults[i]
                if (result.status !== 'fulfilled' || !result.value?.decodedUrl) continue
                // Store the real URL temporarily for og:meta fetch
                ;(needEnrich[i] as any)._realUrl = result.value.decodedUrl
                // Update favicon from real domain
                const domain = getDomain(result.value.decodedUrl)
                if (domain) {
                  const resolvedFavicon = faviconUrl(domain)
                  needEnrich[i].source_icon = resolvedFavicon
                  needEnrich[i].favicon_url = resolvedFavicon
                }
              }
            }

            // Fetch og:image and og:description from the real URL (or original URL for non-Google News)
            const ogResults = await Promise.allSettled(
              needEnrich.map(r => fetchOgMeta((r as any)._realUrl ?? r.url))
            )
            for (let i = 0; i < needEnrich.length; i++) {
              const result = ogResults[i]
              if (result.status !== 'fulfilled') continue
              const { image, description } = result.value
              if (image && !needEnrich[i].image_url) needEnrich[i].image_url = image
              if (description && isGNews) needEnrich[i].snippet = description
            }
            // Clean up temp property before upsert
            for (const r of needEnrich) delete (r as any)._realUrl
          }

          const { error, data } = await supabase
            .from('articles')
            .upsert(rows, { onConflict: 'url' })
            .select('id, title, language, title_translations')

          if (error) {
            results[source.key].error = error.message
          } else {
            totalUpserted += data?.length ?? 0
            // Eagerly translate titles for any article that doesn't yet
            // have translations cached. `title_translations` is `{}` by
            // default, so a row matching that has either just been
            // inserted OR was inserted before this feature shipped —
            // both cases get the same treatment. Translate in parallel
            // with concurrency 5 to stay inside the 120s function budget
            // even on a 30-article batch.
            const needsTitleTx = (data ?? []).filter(r => {
              const tx = (r as any).title_translations
              return !tx || Object.keys(tx).length === 0
            })
            if (needsTitleTx.length > 0) {
              const txCount = await translateTitlesForArticles(supabase, needsTitleTx as Array<{ id: string; title: string; language: string | null }>)
              ;(results[source.key] as any).titles_translated = txCount
            }
          }
        } catch (err) {
          results[source.key] = { fetched: 0, error: String(err) }
        }
      }

      return {
        new: totalUpserted,
        sources_checked: Object.keys(results).length,
        sources: results,
      }
    })

    return NextResponse.json({
      message: 'Article sync complete',
      ...meta,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

// ────────────────────────────────────────────────────────────────────
// Title translation helper
//
// For each article needing translations, makes ONE Claude Haiku call
// that returns a JSON object with translations into all 4 non-source
// app locales. Run with concurrency 5 so a 30-article batch finishes
// in ~12s instead of 60s (which would fight the 120s function budget
// against the cron's other work).
//
// Failures are isolated per article — one Claude error doesn't
// poison the whole batch. The article just keeps its empty
// title_translations and the home page falls back to article.title
// for that user's locale.

async function translateTitlesForArticles(
  supabase: SupabaseClient,
  articles: Array<{ id: string; title: string; language: string | null }>,
): Promise<number> {
  const CONCURRENCY = 5
  let successCount = 0

  const queue = [...articles]
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const article = queue.shift()
      if (!article) return
      try {
        const result = await translateTitleBundle({
          title: article.title,
          sourceLocale: (article.language ?? 'en').slice(0, 2).toLowerCase(),
        })
        // Skip the DB write if Claude returned nothing usable — saves
        // an empty round trip and keeps title_translations as `{}` so
        // a future sync run will retry.
        if (Object.keys(result.translations).length === 0) continue
        const { error } = await supabase
          .from('articles')
          .update({ title_translations: result.translations })
          .eq('id', article.id)
        if (!error) successCount++
        else console.warn(`[sync-articles] title write failed ${article.id}: ${error.message}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[sync-articles] title translate failed ${article.id}: ${msg}`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  return successCount
}
