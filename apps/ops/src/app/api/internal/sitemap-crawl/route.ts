// apps/ops/src/app/api/internal/sitemap-crawl/route.ts
// Daily snapshot of every URL in the production sitemap.xml. Cron 09:15 UTC.
// Used as the ground truth for Opportunities reconciliation.
//
// padelnachos.com publishes a sitemap index with 6 child sitemaps totaling
// ~29k URLs (tournaments, matches, players, daily, news, static). Naive
// per-row INSERTs are far too slow — we batch via multi-row INSERT.

import { NextResponse } from 'next/server'
import { pgPool } from '@/lib/db'
import { parseSitemapXml } from '@/lib/seo/sitemap-parser'
import { parseLocaleFromUrl } from '@/lib/seo/url-classifier'

const ROOT_SITEMAP = 'https://padelnachos.com/sitemap.xml'
const MAX_URLS = 100_000          // safety cap
const BATCH_ROWS = 1_000          // 1,000 rows × 4 params = 4,000 params/stmt (well under PG's 32,767 limit)

// Vercel function timeout. Cron + manual probe both need enough headroom
// for 29k URL writes; 60s default is too tight.
export const maxDuration = 300

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const today = new Date().toISOString().slice(0, 10)
  const visited = new Set<string>()
  const allUrls: string[] = []

  async function fetchSitemap(url: string): Promise<void> {
    if (visited.has(url) || allUrls.length >= MAX_URLS) return
    visited.add(url)
    const res = await fetch(url, { headers: { 'user-agent': 'padel-ops sitemap-crawl/1' } })
    if (!res.ok) {
      console.error('[sitemap-crawl] fetch failed', url, res.status)
      return
    }
    const xml = await res.text()
    const parsed = parseSitemapXml(xml)
    if (parsed.kind === 'index') {
      for (const child of parsed.urls) await fetchSitemap(child)
    } else if (parsed.kind === 'urlset') {
      for (const u of parsed.urls) {
        if (allUrls.length >= MAX_URLS) break
        allUrls.push(u)
      }
    }
  }

  const fetchStart = Date.now()
  await fetchSitemap(ROOT_SITEMAP)
  const fetchMs = Date.now() - fetchStart

  // Pre-classify so we don't repeat the URL parse inside the SQL loop.
  const rows = allUrls.map(url => {
    const { locale, page_type } = parseLocaleFromUrl(url)
    return { url, locale, page_type }
  })

  const pool = pgPool()
  const client = await pool.connect()
  const writeStart = Date.now()
  try {
    await client.query('begin')
    await client.query('delete from public.sitemap_url_snapshot where day = $1', [today])

    // Batch INSERT: 1,000 rows per statement → ~30 statements for 29k URLs.
    for (let i = 0; i < rows.length; i += BATCH_ROWS) {
      const batch = rows.slice(i, i + BATCH_ROWS)
      const values: string[] = []
      const params: (string | null)[] = []
      let p = 1
      for (const row of batch) {
        values.push(`($${p++}, $${p++}, $${p++}, $${p++})`)
        params.push(today, row.url, row.locale, row.page_type)
      }
      await client.query(
        `insert into public.sitemap_url_snapshot (day, url, locale, page_type)
         values ${values.join(', ')}
         on conflict (day, url) do nothing`,
        params,
      )
    }

    await client.query('commit')
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
  const writeMs = Date.now() - writeStart

  return NextResponse.json({
    ok: true,
    day: today,
    urls_written: rows.length,
    fetch_ms: fetchMs,
    write_ms: writeMs,
  })
}
