// apps/ops/src/app/(app)/system/seo/_components/HeadlineTile.tsx
import { Sparkline } from './Sparkline'
import type { WindowDelta } from '@/lib/seo/seo-compute'

interface Props {
  currentClicks: number
  priorClicks: number
  delta: WindowDelta
  sparklineData: number[]
}

const arrow = (d: WindowDelta) =>
  d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '—'

const arrowColor = (d: WindowDelta) =>
  d.direction === 'up' ? '#4ade80' : d.direction === 'down' ? '#f87171' : '#9ca3af'

export function HeadlineTile({ currentClicks, priorClicks, delta, sparklineData }: Props) {
  return (
    <section style={{
      padding: '1.5rem',
      borderRadius: 12,
      background: 'var(--bg-elev-1, #1f2937)',
      marginBottom: '1.5rem',
    }}>
      <div style={{ fontSize: '0.85rem', textTransform: 'uppercase', opacity: 0.6, marginBottom: '0.5rem' }}>
        Clicks · last 7 days
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
        <div style={{ fontSize: '2.5rem', fontWeight: 600 }}>{currentClicks.toLocaleString()}</div>
        <div style={{ color: arrowColor(delta), fontWeight: 500 }}>
          {arrow(delta)} {Math.abs(delta.deltaPct)}%
        </div>
        <div style={{ opacity: 0.6, fontSize: '0.85rem' }}>
          vs {priorClicks.toLocaleString()} prior 7d
        </div>
      </div>
      <div style={{ marginTop: '0.75rem' }}>
        <Sparkline data={sparklineData} />
        <div style={{ fontSize: '0.7rem', opacity: 0.5 }}>90 days</div>
      </div>
    </section>
  )
}
