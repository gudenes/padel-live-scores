// apps/ops/src/app/(app)/growth/page.tsx
// Growth & Adoption overview. Phase 1: Supabase (signups, push opt-ins) +
// Search Console (reused from the SEO dashboard). PostHog-backed panels
// (active users, funnel, retention) and app-install counts are placeholders
// until their integrations land.

import Link from 'next/link'
import { PageHeader, Panel, KpiStrip, Kpi, EmptyState } from '@/components/ui'
import { getRecentSnapshots, getLatestIngestDay, getTopQueries } from '@/lib/seo/seo-queries'
import { sumWindow, windowDelta } from '@/lib/seo/seo-compute'
import type { SnapshotRow, WindowDelta } from '@/lib/seo/seo-compute'
import { TopQueriesTable } from '../system/seo/_components/TopQueriesTable'
import { Sparkline } from '../system/seo/_components/Sparkline'
import {
  getDailySignups, getTotalUsers, getSignupLocales, getPushStats,
  getLatestPosthogSnapshot, getDauSeries,
} from '@/lib/growth/growth-queries'
import { fillDaily, daysUntil, splitWindows, pct, buildRetentionMatrix, weightedRetention } from '@/lib/growth/growth-compute'
import { SignupsChart } from './_components/SignupsChart'
import { PosthogPanels } from './_components/PosthogPanels'
import { NotificationsPanel } from './_components/NotificationsPanel'
import { BetaSignupsPanel } from './_components/BetaSignupsPanel'
import { getBetaSignupStats } from '@/lib/growth/beta-signups'
import { BETA_SIGNUPS_CLOSE_AT } from '../../../../../../src/lib/beta-schedule'
import { fetchNotificationCatalog, fetchRecentSends } from '@/lib/growth/notifications-source'
import { summarizeCatalog, sortCatalog, recentRealSends } from '@/lib/growth/notifications-compute'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Growth & Adoption · PadelNachos Admin' }

const WINDOW_DAYS = 30

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
const betaDaysLeft = () => daysUntil(BETA_SIGNUPS_CLOSE_AT, Date.now())
const isoHoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString()
const inRange = (r: SnapshotRow, from: string, to: string) => r.day >= from && r.day <= to

function DeltaText({ d, unit = '%' }: { d: WindowDelta; unit?: string }) {
  const color = d.direction === 'up' ? 'var(--lime-text)' : d.direction === 'down' ? 'var(--live-text)' : 'var(--text-3)'
  const arrow = d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '—'
  return <span style={{ color, fontSize: 13, fontWeight: 600 }}>{arrow} {d.deltaPct === 999 ? 'new' : `${Math.abs(d.deltaPct)}${unit}`}</span>
}

function KpiWithDelta({ label, value, delta, tone }: { label: string; value: string; delta: WindowDelta; tone: 'lime' | 'warn' | 'neutral' }) {
  return (
    <Kpi
      label={label}
      tone={tone}
      value={<>{value} <DeltaText d={delta} /></>}
    />
  )
}

export default async function Page() {
  const [signupRows, totalUsers, locales, push, snapshots, latestIngest, ph, dauRows, catalogRaw, allSends, beta] = await Promise.all([
    getDailySignups(WINDOW_DAYS * 2),
    getTotalUsers(),
    getSignupLocales(WINDOW_DAYS),
    getPushStats(WINDOW_DAYS),
    getRecentSnapshots(120),
    getLatestIngestDay(),
    getLatestPosthogSnapshot(),
    getDauSeries(WINDOW_DAYS),
    fetchNotificationCatalog(),
    fetchRecentSends(),
    getBetaSignupStats(WINDOW_DAYS),
  ])
  const topQueries = latestIngest ? await getTopQueries(latestIngest.day, 8) : []

  // Signups
  const signups = fillDaily(signupRows, isoDaysAgo(0), WINDOW_DAYS * 2)
  const sw = splitWindows(signups, WINDOW_DAYS)
  const signupDelta = windowDelta(sw.current, sw.prior)
  const pushDelta = windowDelta(push.newCurrent, push.newPrior)

  // Organic clicks — same 7d window + 3d Search Console lag as the SEO page
  const totalRows = snapshots.filter(r => r.locale === 'total')
  const cur = sumWindow(totalRows.filter(r => inRange(r, isoDaysAgo(9), isoDaysAgo(3))))
  const prior = sumWindow(totalRows.filter(r => inRange(r, isoDaysAgo(16), isoDaysAgo(10))))
  const clicksDelta = windowDelta(cur.clicks, prior.clicks)
  const clickSpark = totalRows.slice(-90).map(r => r.clicks)

  // Notifications — same sources as the Notifications + Broadcast tabs
  const notif = catalogRaw ? summarizeCatalog(catalogRaw) : null
  const catalog = catalogRaw ? sortCatalog(catalogRaw) : null
  const sends = recentRealSends(allSends, isoHoursAgo(36), 25)

  const localeTotal = locales.reduce((a, l) => a + l.n, 0)

  return (
    <div className="ui-page">
      <PageHeader
        title="Growth & Adoption"
        subtitle="Are we acquiring users, and are they adopting the product? Last 30 days vs the 30 before."
        actions={<Link href="/system/seo" style={{ color: 'var(--text-3)', textDecoration: 'none' }}>SEO detail →</Link>}
      />

      <KpiStrip cols={4}>
        <Kpi label="Total users" tone="lime" value={totalUsers.toLocaleString()} />
        <KpiWithDelta label="New signups · 30d" tone="lime" value={sw.current.toLocaleString()} delta={signupDelta} />
        <KpiWithDelta label="New push opt-ins · 30d" tone="warn" value={push.newCurrent.toLocaleString()} delta={pushDelta} />
        <KpiWithDelta label="Organic clicks · 7d" tone="neutral" value={cur.clicks.toLocaleString()} delta={clicksDelta} />
      </KpiStrip>

      <div style={{ marginTop: 14 }}>
        <BetaSignupsPanel
          stats={beta}
          closesAt={BETA_SIGNUPS_CLOSE_AT}
          daysLeft={betaDaysLeft()}
          days={fillDaily(beta?.byDay ?? [], isoDaysAgo(0), WINDOW_DAYS)}
        />
      </div>

      {notif && (
        <KpiStrip cols={4}>
          <Kpi label="Pushes sent · 7d" tone="lime" value={notif.sends7d.toLocaleString()} />
          <Kpi label="Recipients · 7d" tone="lime" value={notif.recipients7d.toLocaleString()} />
          <Kpi label="Failed · 7d" tone={notif.failed7d > 0 ? 'warn' : 'neutral'} value={notif.failed7d.toLocaleString()} />
          <Kpi label="Live notification types" tone="neutral" value={notif.liveCategories.toLocaleString()} />
        </KpiStrip>
      )}

      {ph && (() => {
        const v = (m: string) => ph.rows.find(r => r.metric === m)?.value ?? 0
        const dauLatest = dauRows.length ? dauRows[dauRows.length - 1].n : 0
        const wk1 = weightedRetention(buildRetentionMatrix(ph.rows, ph.day), 1)
        return (
          <KpiStrip cols={4}>
            <Kpi label="Monthly active" tone="lime" value={v('mau').toLocaleString()} />
            <Kpi label="Weekly active" tone="lime" value={v('wau').toLocaleString()} />
            <Kpi label="Stickiness (DAU/MAU)" tone="warn" value={`${pct(dauLatest, v('mau'))}%`} />
            <Kpi label="Week-1 retention" tone="neutral" value={wk1 == null ? '—' : `${wk1}%`} />
          </KpiStrip>
        )
      })()}

      <div className="growth-grid">
        <Panel title="Daily signups · last 30 days">
          <SignupsChart data={signups.slice(-WINDOW_DAYS)} />
        </Panel>

        <Panel title="Signups by locale · 30d">
          {locales.length === 0 ? (
            <EmptyState title="No signups in the last 30 days." />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {locales.map(l => (
                <div key={l.locale} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 72px', gap: 10, alignItems: 'center', fontSize: 13 }}>
                  <span style={{ textTransform: 'uppercase', color: 'var(--text-2)' }}>{l.locale}</span>
                  <div style={{ height: 10, background: 'var(--track)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${pct(l.n, localeTotal)}%`, height: '100%', background: 'var(--lime)' }} />
                  </div>
                  <span style={{ textAlign: 'right', color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                    {l.n.toLocaleString()} · {pct(l.n, localeTotal)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Push adoption (web push)">
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 6 }}>Signed-in users with web push enabled</div>
          <div style={{ fontFamily: 'var(--display)', fontSize: 30, fontWeight: 700 }}>
            {pct(push.usersWithPush, totalUsers)}%
            <span style={{ fontSize: 14, color: 'var(--text-3)', fontWeight: 400 }}> · {push.usersWithPush.toLocaleString()} of {totalUsers.toLocaleString()}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 8 }}>
            Native Android/iOS push opt-ins are not included yet.
          </div>
        </Panel>

        <Panel title="Organic search clicks · 90 days">
          <Sparkline data={clickSpark} width={420} height={56} />
          <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 6 }}>Source: Search Console</div>
        </Panel>
      </div>

      <div style={{ marginTop: 14 }}>
        <TopQueriesTable queries={topQueries} />
      </div>

      {ph ? (
        <PosthogPanels day={ph.day} rows={ph.rows} dau={fillDaily(dauRows, ph.day, WINDOW_DAYS)} />
      ) : (
        <div style={{ marginTop: 14 }}>
          <Panel title="Active users, funnel & retention">
            <EmptyState
              title="No PostHog snapshot yet"
              hint="Set POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID, apply the growth_snapshots migration, then POST /api/internal/growth-snapshot with the CRON_SECRET bearer."
            />
          </Panel>
        </div>
      )}

      <NotificationsPanel catalog={catalog} sends={sends} />

      <div className="growth-grid" style={{ marginTop: 14 }}>
        <Panel title="App installs">
          <EmptyState
            title="Not connected"
            hint="Android (Play Console), iOS (App Store Connect) and PWA installs. Needs store API credentials."
          />
        </Panel>
      </div>

      <style>{`
        .growth-grid { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        @media (max-width: 900px) { .growth-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  )
}
