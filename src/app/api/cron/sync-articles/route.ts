// src/app/api/cron/sync-articles/route.ts
// Fetches padel news from RSS feeds + FIP WordPress API, upserts into articles table.
// Runs every 6 hours via Vercel cron.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import Parser from 'rss-parser'

export const maxDuration = 60

// ── Source definitions ──────────────────────────────────────────────────────

interface ArticleSource {
  key: string
  name: string
  icon: string
  language: string
  weight: number
  type: 'rss' | 'wp-api'
  url: string
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
}

// ── RSS fetcher ─────────────────────────────────────────────────────────────

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'PadelNacho/1.0 (+https://padel-live-scores.vercel.app)' },
})

async function fetchRSS(source: ArticleSource): Promise<ArticleRow[]> {
  const feed = await parser.parseURL(source.url)
  const cutoff = Date.now() - 14 * 86400000 // last 14 days
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

    // For Google News: extract the real source from the title and use the article domain for favicon
    const rawTitle = stripHtml(item.title)
    const isGoogleNews = source.key.startsWith('google-news')
    const realSource = isGoogleNews ? extractRealSource(rawTitle, source.name) : source.name
    // Strip the source suffix from Google News titles ("Title - Source" → "Title")
    const cleanTitle = isGoogleNews && rawTitle.lastIndexOf(' - ') > 0
      ? rawTitle.substring(0, rawTitle.lastIndexOf(' - ')).trim()
      : rawTitle
    const domain = getDomain(item.link)
    const iconUrl = domain ? faviconUrl(domain) : null

    rows.push({
      title: cleanTitle,
      source_name: realSource,
      source_icon: iconUrl ?? source.icon,
      source_key: source.key,
      url: item.link,
      image_url: imageUrl,
      snippet,
      language: source.language,
      published_at: pubDate.toISOString(),
      source_weight: source.weight,
      updated_at: new Date().toISOString(),
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
    headers: { 'User-Agent': 'PadelNacho/1.0' },
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
      image_url: imageUrl,
      snippet: truncate(stripHtml(post.excerpt.rendered)),
      language: source.language,
      published_at: new Date(post.date).toISOString(),
      source_weight: source.weight,
      updated_at: new Date().toISOString(),
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

      const { error, data } = await supabase
        .from('articles')
        .upsert(rows, { onConflict: 'url' })
        .select('id')

      if (error) {
        results[source.key].error = error.message
      } else {
        totalUpserted += data?.length ?? 0
      }
    } catch (err) {
      results[source.key] = { fetched: 0, error: String(err) }
    }
  }

  return NextResponse.json({
    message: 'Article sync complete',
    totalUpserted,
    sources: results,
  })
}
