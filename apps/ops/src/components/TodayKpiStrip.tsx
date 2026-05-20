// apps/ops/src/components/TodayKpiStrip.tsx
// Four tiles in a row across the top of the Today page. Per the spec's
// "Today" screen mockup. Variation 2: large numerics, quiet labels,
// status-color dot on each tile to reinforce urgency at a glance.

import type { TodayPayload } from '@/lib/today-aggregator'

interface TileSpec {
  label: string
  value: number
  dot?: string
  pulse?: boolean
}

export function TodayKpiStrip({ kpis }: { kpis: TodayPayload['kpis'] }) {
  const tiles: TileSpec[] = [
    { label: 'Live Matches', value: kpis.liveMatches, dot: 'var(--status-live)', pulse: kpis.liveMatches > 0 },
    { label: 'Needs Review', value: kpis.needsReview, dot: 'var(--status-warn)' },
    { label: 'OOP Pending', value: kpis.oopPending, dot: 'var(--status-urgent)' },
    { label: 'Streams Live', value: kpis.streamsLive, dot: 'var(--status-live)' },
  ]
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 16,
        marginBottom: 24,
      }}
    >
      {tiles.map((t) => (
        <div
          key={t.label}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            padding: '20px 20px 16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--status-neutral)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {t.dot && (
              <span
                className={t.pulse ? 'live-pulse' : undefined}
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: t.dot,
                }}
              />
            )}
            {t.label}
          </div>
          <div
            className="tabular"
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: 'var(--brand-primary-fg)',
              marginTop: 8,
              lineHeight: 1,
            }}
          >
            {t.value}
          </div>
        </div>
      ))}
    </div>
  )
}
