// apps/ops/src/app/api/internal/seo-snapshot/route.ts
// Daily GSC ingest. Vercel cron 09:00 UTC. Pulls data for today-3 (GSC
// settles by day-3), aggregates into 6 locale buckets, UPSERTs.
// See docs/superpowers/specs/2026-05-25-seo-daily-dashboard-design.md.

import { NextResponse } from 'next/server'
import { pgPool } from '@/lib/db'
import { GscClient, type GscRow } from '@/lib/seo/gsc-client'
import { parseLocaleFromUrl } from '@/lib/seo/url-classifier'

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
}

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

// Vercel cron jobs invoke the path with a GET request, so alias GET to the
// same handler. Without this the daily cron 405s and the ingest never runs
// (the only writes come from manual POSTs). The CRON_SECRET check inside
// handles auth for both methods; Vercel injects the bearer header on crons.
export const GET = POST

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const url = new URL(req.url)
  const probe = url.searchParams.get('probe') === 'true'
  const targetDay = url.searchParams.get('day') ?? isoDaysAgo(3)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDay)) {
    return NextResponse.json({ error: 'invalid_day', message: 'day must be YYYY-MM-DD' }, { status: 400 })
  }

  let gsc
  try {
    gsc = GscClient.fromEnv()
  } catch (e) {
    return NextResponse.json({ error: 'gsc_config', message: String(e) }, { status: 500 })
  }

  if (probe) {
    try {
      const sites = await gsc.listSites()
      return NextResponse.json({ ok: true, sites })
    } catch (e) {
      return NextResponse.json({ error: 'gsc_probe_failed', message: String(e) }, { status: 502 })
    }
  }

  let pageTotals: GscRow[]
  let topQueries: GscRow[]
  let topPages: GscRow[]
  try {
    pageTotals = await gsc.query({
      startDate: targetDay,
      endDate: targetDay,
      dimensions: ['page', 'date'],
      rowLimit: 25_000,
    })
    topQueries = await gsc.query({
      startDate: targetDay,
      endDate: targetDay,
      dimensions: ['query'],
      rowLimit: 20,
    })
    topPages = await gsc.query({
      startDate: targetDay,
      endDate: targetDay,
      dimensions: ['page'],
      rowLimit: 200,
    })
  } catch (e) {
    console.error('[seo-snapshot] GSC pull failed:', e)
    return NextResponse.json({ error: 'gsc_pull_failed', message: String(e) }, { status: 502 })
  }

  // Aggregate page-level totals into 6 buckets: total + 5 locales
  const buckets = new Map<string, {
    clicks: number; impressions: number; posSum: number; posWeight: number
  }>()
  const initBucket = () => ({ clicks: 0, impressions: 0, posSum: 0, posWeight: 0 })
  for (const locale of ['total', 'en', 'es', 'pt', 'it', 'fr'] as const) {
    buckets.set(locale, initBucket())
  }

  for (const row of pageTotals) {
    const pageUrl = row.keys[0]
    const { locale } = parseLocaleFromUrl(pageUrl)
    const targets = [buckets.get(locale)!, buckets.get('total')!]
    for (const b of targets) {
      b.clicks += row.clicks
      b.impressions += row.impressions
      if (row.position && row.impressions) {
        b.posSum += row.position * row.impressions
        b.posWeight += row.impressions
      }
    }
  }

  const pool = pgPool()

  // UPSERT seo_snapshots — one query per locale
  for (const [locale, b] of buckets.entries()) {
    const avg_position = b.posWeight > 0 ? Math.round((b.posSum / b.posWeight) * 100) / 100 : null
    const ctr = b.impressions > 0 ? Math.round((b.clicks / b.impressions) * 10000) / 10000 : null
    await pool.query(
      `insert into public.seo_snapshots (day, locale, clicks, impressions, avg_position, ctr, fetched_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (day, locale) do update set
         clicks = excluded.clicks,
         impressions = excluded.impressions,
         avg_position = excluded.avg_position,
         ctr = excluded.ctr,
         fetched_at = excluded.fetched_at`,
      [targetDay, locale, b.clicks, b.impressions, avg_position, ctr],
    )
  }

  // UPSERT seo_top_queries
  for (let i = 0; i < topQueries.length; i++) {
    const q = topQueries[i]
    await pool.query(
      `insert into public.seo_top_queries (day, query, clicks, impressions, position, rank)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (day, query) do update set
         clicks = excluded.clicks,
         impressions = excluded.impressions,
         position = excluded.position,
         rank = excluded.rank`,
      [targetDay, q.keys[0], q.clicks, q.impressions, q.position ?? null, i + 1],
    )
  }

  // UPSERT seo_top_pages
  for (let i = 0; i < topPages.length; i++) {
    const p = topPages[i]
    const pageUrl = p.keys[0]
    const { locale, page_type } = parseLocaleFromUrl(pageUrl)
    await pool.query(
      `insert into public.seo_top_pages (day, url, locale, page_type, clicks, impressions, position, rank)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (day, url) do update set
         locale = excluded.locale,
         page_type = excluded.page_type,
         clicks = excluded.clicks,
         impressions = excluded.impressions,
         position = excluded.position,
         rank = excluded.rank`,
      [targetDay, pageUrl, locale, page_type, p.clicks, p.impressions, p.position ?? null, i + 1],
    )
  }

  return NextResponse.json({
    ok: true,
    day: targetDay,
    locales_written: buckets.size,
    queries_written: topQueries.length,
    pages_written: topPages.length,
  })
}
