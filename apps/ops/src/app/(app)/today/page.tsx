// apps/ops/src/app/(app)/today/page.tsx
// The real Today dashboard — KPIs, LIVE NOW, REQUIRES ATTENTION,
// TODAY'S SCHEDULE, status pill. Reads through getTodayPayload() at
// request time (server component), so each page render gets fresh
// data.

import { auth } from '@/lib/auth'
import { getTodayPayload } from '@/lib/today-aggregator'
import { PageHeader, KpiStrip, Kpi } from '@/components/ui'
import { TodayLiveNow } from '@/components/TodayLiveNow'
import { TodayRequiresAttention } from '@/components/TodayRequiresAttention'
import { TodaySchedule } from '@/components/TodaySchedule'
import { TodayStatusPill } from '@/components/TodayStatusPill'
import { TodayRefreshButton } from '@/components/TodayRefreshButton'

export const metadata = { title: 'Today · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const [session, payload] = await Promise.all([auth(), getTodayPayload()])
  const { kpis } = payload
  return (
    <div className="ui-page">
      <PageHeader
        title="Today"
        subtitle={`Welcome back, ${session?.user?.name?.split(' ')[0] ?? session?.user?.email}.`}
        actions={
          <>
            <TodayRefreshButton />
            <TodayStatusPill status={payload.systemStatus} />
          </>
        }
      />

      <KpiStrip cols={4}>
        <Kpi label="Live Matches" value={kpis.liveMatches} tone="live" pulse={kpis.liveMatches > 0} />
        <Kpi label="Needs Review" value={kpis.needsReview} tone="warn" />
        <Kpi label="OOP Pending" value={kpis.oopPending} tone="urgent" />
        <Kpi label="Streams Live" value={kpis.streamsLive} tone="lime" />
      </KpiStrip>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <TodayLiveNow matches={payload.liveNow} />
        <TodayRequiresAttention rows={payload.requiresAttention} />
      </div>

      <TodaySchedule buckets={payload.schedule} />

      <div style={{ marginTop: 24, fontSize: 11, color: 'var(--text-3)' }}>
        Updated {new Date(payload.fetchedAt).toLocaleTimeString()}
      </div>
    </div>
  )
}
