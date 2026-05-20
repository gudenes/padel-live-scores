// apps/ops/src/app/(app)/today/page.tsx
// The real Today dashboard — KPIs, LIVE NOW, REQUIRES ATTENTION,
// TODAY'S SCHEDULE, status pill. Reads through getTodayPayload() at
// request time (server component), so each page render gets fresh
// data.

import { auth } from '@/lib/auth'
import { getTodayPayload } from '@/lib/today-aggregator'
import { TodayKpiStrip } from '@/components/TodayKpiStrip'
import { TodayLiveNow } from '@/components/TodayLiveNow'
import { TodayRequiresAttention } from '@/components/TodayRequiresAttention'
import { TodaySchedule } from '@/components/TodaySchedule'
import { TodayStatusPill } from '@/components/TodayStatusPill'

export const metadata = { title: 'Today · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const [session, payload] = await Promise.all([auth(), getTodayPayload()])
  return (
    <div style={{ padding: 32, maxWidth: 1280 }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Today</h1>
          <p style={{ fontSize: 13, color: 'var(--status-neutral)', margin: 0 }}>
            Welcome back, {session?.user?.name?.split(' ')[0] ?? session?.user?.email}.
          </p>
        </div>
        <TodayStatusPill status={payload.systemStatus} />
      </div>

      <TodayKpiStrip kpis={payload.kpis} />

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

      <div style={{ marginTop: 24, fontSize: 11, color: 'var(--status-neutral)' }}>
        Updated {new Date(payload.fetchedAt).toLocaleTimeString()}
      </div>
    </div>
  )
}
