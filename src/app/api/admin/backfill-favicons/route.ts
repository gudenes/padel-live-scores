// src/app/api/admin/backfill-favicons/route.ts
// Backfills favicon_url for articles.
// 1. Articles with no favicon_url → derive from article URL domain
// 2. Google News articles with news.google.com favicon → resolve real publisher domain
//    by fetching the RSS feed and extracting <source url="..."> mappings

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const maxDuration = 60

function getDomain(url: string): string | null {
  try { return new URL(url).hostname } catch { return null }
}

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?sz=64&domain=${domain}`
}

// Google News RSS feed URLs — same as in sync-articles
const GOOGLE_NEWS_FEEDS = [
  'https://news.google.com/rss/search?q=padel+premier+padel&hl=en&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=padel+premier+padel&hl=es&gl=ES&ceid=ES:es',
  'https://news.google.com/rss/search?q=padel+premier+padel&hl=pt-PT&gl=PT&ceid=PT:pt-150',
  'https://news.google.com/rss/search?q=padel+premier+padel&hl=pt-BR&gl=BR&ceid=BR:pt-419',
]

// Fetch all Google News RSS feeds and build a map of source name → publisher domain
async function buildSourceDomainMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const results = await Promise.allSettled(
    GOOGLE_NEWS_FEEDS.map(async (feedUrl) => {
      const res = await fetch(feedUrl, {
        headers: { 'User-Agent': 'PadelNachos/1.0 (+https://padelnachos.com)' },
      })
      if (!res.ok) return
      const xml = await res.text()
      const matches = xml.matchAll(/<source\s+url="([^"]+)"[^>]*>([^<]+)<\/source>/gi)
      for (const m of matches) {
        const domain = getDomain(m[1].trim())
        if (domain) map.set(m[2].trim(), domain)
      }
    })
  )
  return map
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  // Step 1: Fix articles with no favicon at all
  const { data: nullArticles } = await supabase
    .from('articles')
    .select('id, url, source_key')
    .is('favicon_url', null)
    .order('published_at', { ascending: false })
    .limit(100)

  let updated = 0
  let failed = 0

  if (nullArticles && nullArticles.length > 0) {
    for (let i = 0; i < nullArticles.length; i += 10) {
      const batch = nullArticles.slice(i, i + 10)
      const results = await Promise.allSettled(
        batch.map(async (article) => {
          const domain = getDomain(article.url)
          if (!domain) return null
          const favicon = faviconUrl(domain)
          const { error } = await supabase
            .from('articles')
            .update({ favicon_url: favicon })
            .eq('id', article.id)
          if (error) throw error
          return favicon
        })
      )
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) updated++
        else failed++
      }
    }
  }

  // Step 2: Fix Google News articles that have news.google.com favicon
  const { data: googleArticles } = await supabase
    .from('articles')
    .select('id, url, source_name, source_key, favicon_url')
    .like('source_key', 'google-news%')
    .like('favicon_url', '%news.google.com%')
    .order('published_at', { ascending: false })
    .limit(200)

  let googleFixed = 0
  let googleFailed = 0

  if (googleArticles && googleArticles.length > 0) {
    // Build source name → domain map from current RSS feeds
    const sourceMap = await buildSourceDomainMap()

    for (let i = 0; i < googleArticles.length; i += 10) {
      const batch = googleArticles.slice(i, i + 10)
      const results = await Promise.allSettled(
        batch.map(async (article) => {
          const publisherDomain = sourceMap.get(article.source_name)
          if (!publisherDomain) return null

          const favicon = faviconUrl(publisherDomain)
          const { error } = await supabase
            .from('articles')
            .update({ favicon_url: favicon, source_icon: favicon })
            .eq('id', article.id)
          if (error) throw error
          return favicon
        })
      )
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) googleFixed++
        else googleFailed++
      }
    }
  }

  return NextResponse.json({
    message: 'Favicon backfill complete',
    nullFavicons: { total: nullArticles?.length ?? 0, updated, failed },
    googleNews: {
      total: googleArticles?.length ?? 0,
      fixed: googleFixed,
      notInFeed: googleFailed,
      sourcesFound: 'check RSS feeds for current sources',
    },
  })
}
