// apps/ops/src/app/api/internal/sitemap-crawl/route.ts
// Daily snapshot of every URL in the production sitemap.xml. Cron 09:15 UTC.
// Used as the ground truth for Opportunities reconciliation.

import { NextResponse } from 'next/server'
import { pgPool } from '@/lib/db'
import { parseSitemapXml } from '@/lib/seo/sitemap-parser'
import { parseLocaleFromUrl } from '@/lib/seo/url-classifier'

const ROOT_SITEMAP = 'https://padelnachos.com/sitemap.xml'
const MAX_URLS = 100_000  // safety cap

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

  await fetchSitemap(ROOT_SITEMAP)

  const pool = pgPool()
  // Single transaction: nuke today's rows, insert fresh. Avoids half-state
  // if the crawl is interrupted.
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('delete from public.sitemap_url_snapshot where day = $1', [today])
    for (const u of allUrls) {
      const { locale, page_type } = parseLocaleFromUrl(u)
      await client.query(
        `insert into public.sitemap_url_snapshot (day, url, locale, page_type)
         values ($1, $2, $3, $4)
         on conflict (day, url) do nothing`,
        [today, u, locale, page_type],
      )
    }
    await client.query('commit')
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }

  return NextResponse.json({ ok: true, day: today, urls_written: allUrls.length })
}
