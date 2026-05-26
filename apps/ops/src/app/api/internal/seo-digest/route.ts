// apps/ops/src/app/api/internal/seo-digest/route.ts
// Daily morning digest email. Cron 09:30 UTC (30 min after snapshot).

import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { pgPool } from '@/lib/db'
import { sumWindow, windowDelta } from '@/lib/seo/seo-compute'
import { computeBullets, type DigestSignals } from '@/lib/seo/digest-rules'
import { buildDigestHtml, buildDigestSubject, type DigestData } from '@/lib/seo/digest-template'

const DASHBOARD_URL = 'https://admin.padelnachos.com/system/seo'
const STALE_HOURS = 36

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const recipients = (process.env.SEO_DIGEST_RECIPIENTS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'no_recipients' }, { status: 500 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const pool = pgPool()

  // Idempotency: did we already send today?
  const existing = await pool.query<{ status: string }>(
    `select status from public.seo_digest_sends where digest_date = $1 and status = 'sent' limit 1`,
    [today],
  )
  if (existing.rows.length > 0) {
    return NextResponse.json({ ok: true, skipped: 'already_sent' })
  }

  // Latest ingest
  const latest = await pool.query<{ day: string; fetched_at: string }>(
    `select day::text as day, fetched_at::text as fetched_at
       from public.seo_snapshots where locale = 'total'
       order by day desc limit 1`,
  )
  const ingestStale =
    latest.rows.length === 0 ||
    (Date.now() - new Date(latest.rows[0].fetched_at).getTime()) / 3_600_000 > STALE_HOURS

  // 7d window snapshots
  const fromCurrent = isoDaysAgo(9)
  const toCurrent = isoDaysAgo(3)
  const fromPrior = isoDaysAgo(16)
  const toPrior = isoDaysAgo(10)
  const snaps = await pool.query<{ day: string; locale: string; clicks: number; impressions: number; avg_position: number | null; ctr: number | null }>(
    `select day::text as day, locale, clicks, impressions, avg_position::float as avg_position, ctr::float as ctr
       from public.seo_snapshots
      where day >= $1
      order by day asc`,
    [fromPrior],
  )

  const inRange = (r: { day: string }, from: string, to: string) => r.day >= from && r.day <= to

  const total = snaps.rows.filter(r => r.locale === 'total')
  const curT = sumWindow(total.filter(r => inRange(r, fromCurrent, toCurrent)))
  const priorT = sumWindow(total.filter(r => inRange(r, fromPrior, toPrior)))
  const deltaT = windowDelta(curT.clicks, priorT.clicks)

  const localeRows = (['en', 'es', 'pt', 'it', 'fr'] as const).map(locale => {
    const localeAll = snaps.rows.filter(r => r.locale === locale)
    const cur = sumWindow(localeAll.filter(r => inRange(r, fromCurrent, toCurrent)))
    const prior = sumWindow(localeAll.filter(r => inRange(r, fromPrior, toPrior)))
    const d = windowDelta(cur.clicks, prior.clicks)
    return { locale, clicks: cur.clicks, priorClicks: prior.clicks, deltaPct: d.deltaPct, direction: d.direction }
  })

  // Signal: sitemap size delta (today vs yesterday)
  const sitemapDelta = await pool.query<{ delta_pct: number | null }>(
    `with d as (
       select day, count(*)::int as n from public.sitemap_url_snapshot
        where day >= current_date - interval '1 day'
        group by day
     )
     select case when (select n from d where day = current_date - interval '1 day') > 0
                 then round(100.0 * ((select n from d where day = current_date) - (select n from d where day = current_date - interval '1 day'))
                             / (select n from d where day = current_date - interval '1 day'))::int
                 else 0 end as delta_pct`,
  )

  // Signal: count of locale-gap pages currently flagged.
  // Reuses getLocaleGaps to keep classification logic in one place.
  const { getLocaleGaps } = await import('@/lib/seo/seo-queries')
  const gapList = await getLocaleGaps(1000)
  const newLocaleGapCount = gapList.length

  const signals: DigestSignals = {
    totalDirection: deltaT.direction,
    localeDeltas: Object.fromEntries(localeRows.map(r => [r.locale, r.deltaPct])) as DigestSignals['localeDeltas'],
    newLocaleGapCount,
    sitemapSizeDeltaPct: sitemapDelta.rows[0]?.delta_pct ?? 0,
  }

  const data: DigestData = {
    digestDate: today,
    dataThroughDay: latest.rows[0]?.day ?? today,
    snapshotFetchedAt: latest.rows[0]?.fetched_at ?? new Date().toISOString(),
    currentClicks: curT.clicks,
    priorClicks: priorT.clicks,
    delta: deltaT,
    localeRows,
    bullets: ingestStale
      ? [`Ingest is stale — last successful run was more than ${STALE_HOURS}h ago. Check Vercel cron logs.`]
      : computeBullets(signals),
    dashboardUrl: DASHBOARD_URL,
  }

  const subject = buildDigestSubject(data, ingestStale)
  const html = buildDigestHtml(data)

  const resend = new Resend(process.env.RESEND_API_KEY!)
  let allOk = true
  for (const to of recipients) {
    let recipientOk = true
    let recipientError: string | null = null
    try {
      await resend.emails.send({
        from: 'SEO Dashboard <seo@padelnachos.com>',
        to: [to],
        subject,
        html,
      })
    } catch (e) {
      recipientOk = false
      recipientError = String(e)
      allOk = false
    }
    await pool.query(
      `insert into public.seo_digest_sends (digest_date, recipient, status, error)
         values ($1, $2, $3, $4)
         on conflict (digest_date, recipient) do update set
           status = excluded.status, error = excluded.error, sent_at = now()`,
      [today, to, recipientOk ? 'sent' : 'failed', recipientError],
    )
  }

  return NextResponse.json({ ok: allOk, day: today, recipients: recipients.length })
}
