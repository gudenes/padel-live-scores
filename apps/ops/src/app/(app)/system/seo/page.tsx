// apps/ops/src/app/(app)/system/seo/page.tsx
// SEO overview dashboard. Reads seo_snapshots (last 90d) + seo_top_queries
// (last day) and renders headline, sparkline, locale table, top queries.

import Link from 'next/link'
import { getRecentSnapshots, getLatestIngestDay, getTopQueries } from '@/lib/seo/seo-queries'
import { sumWindow, windowDelta, weightedAvgPosition } from '@/lib/seo/seo-compute'
import type { SnapshotRow } from '@/lib/seo/seo-compute'
import { HeadlineTile } from './_components/HeadlineTile'
import { LocaleTable, type LocaleRow } from './_components/LocaleTable'
import { TopQueriesTable } from './_components/TopQueriesTable'
import { StaleBanner } from './_components/StaleBanner'

export const dynamic = 'force-dynamic'  // always read fresh from Postgres
export const metadata = { title: 'SEO · PadelNachos Admin' }

const LOCALES = ['en', 'es', 'pt', 'it', 'fr'] as const

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
}

function inRange(row: SnapshotRow, from: string, to: string): boolean {
  return row.day >= from && row.day <= to
}

export default async function Page() {
  const [snapshots, latestIngest] = await Promise.all([
    getRecentSnapshots(120),
    getLatestIngestDay(),
  ])

  const hoursSinceIngest = latestIngest
    ? (Date.now() - new Date(latestIngest.fetched_at).getTime()) / 3_600_000
    : null

  const topQueries = latestIngest ? await getTopQueries(latestIngest.day) : []

  // Window definitions
  const fromCurrent = isoDaysAgo(9)
  const toCurrent   = isoDaysAgo(3)
  const fromPrior   = isoDaysAgo(16)
  const toPrior     = isoDaysAgo(10)

  // Totals row
  const totalRows = snapshots.filter(r => r.locale === 'total')
  const curTotal   = sumWindow(totalRows.filter(r => inRange(r, fromCurrent, toCurrent)))
  const priorTotal = sumWindow(totalRows.filter(r => inRange(r, fromPrior, toPrior)))
  const headlineDelta = windowDelta(curTotal.clicks, priorTotal.clicks)

  // Sparkline: last 90 days of total clicks
  const sparklineData = totalRows
    .slice(-90)
    .map(r => r.clicks)

  // Per-locale rows
  const localeRows: LocaleRow[] = LOCALES.map(locale => {
    const localeAll = snapshots.filter(r => r.locale === locale)
    const cur   = sumWindow(localeAll.filter(r => inRange(r, fromCurrent, toCurrent)))
    const prior = sumWindow(localeAll.filter(r => inRange(r, fromPrior, toPrior)))
    return {
      locale,
      clicks: cur.clicks,
      priorClicks: prior.clicks,
      delta: windowDelta(cur.clicks, prior.clicks),
      impressions: cur.impressions,
      avgPosition: weightedAvgPosition(localeAll.filter(r => inRange(r, fromCurrent, toCurrent))),
    }
  })

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1080 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>SEO Health</h1>
          <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
            {latestIngest
              ? `Last ingest: ${latestIngest.day} (data) · fetched ${new Date(latestIngest.fetched_at).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC`
              : 'No data yet'}
          </p>
        </div>
        <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span style={{ borderBottom: '2px solid var(--brand-primary)', paddingBottom: '0.25rem', fontWeight: 500 }}>Overview</span>
          <Link href="/system/seo/opportunities" style={{ color: '#6b7280', textDecoration: 'none' }}>Opportunities →</Link>
        </nav>
      </header>

      <StaleBanner hoursSinceIngest={hoursSinceIngest} />

      <HeadlineTile
        currentClicks={curTotal.clicks}
        priorClicks={priorTotal.clicks}
        delta={headlineDelta}
        sparklineData={sparklineData}
      />

      <LocaleTable rows={localeRows} />

      <TopQueriesTable queries={topQueries} />
    </div>
  )
}
