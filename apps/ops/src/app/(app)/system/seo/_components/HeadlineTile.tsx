// apps/ops/src/app/(app)/system/seo/_components/HeadlineTile.tsx
import { Panel } from '@/components/ui'
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
  d.direction === 'up' ? 'var(--lime-text)' : d.direction === 'down' ? 'var(--live-text)' : 'var(--text-3)'

export function HeadlineTile({ currentClicks, priorClicks, delta, sparklineData }: Props) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <Panel>
        <div style={{
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--text-3)',
          marginBottom: '0.5rem',
        }}>
          Clicks · last 7 days
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
          <div style={{ fontSize: '2.5rem', fontWeight: 600, color: 'var(--text-1)' }}>
            {currentClicks.toLocaleString()}
          </div>
          <div style={{ color: arrowColor(delta), fontWeight: 600, fontSize: '1rem' }}>
            {arrow(delta)} {Math.abs(delta.deltaPct)}%
          </div>
          <div style={{ color: 'var(--text-3)', fontSize: '0.875rem' }}>
            vs {priorClicks.toLocaleString()} prior 7d
          </div>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <Sparkline data={sparklineData} />
          <div style={{ fontSize: '0.7rem', color: 'var(--text-4)', marginTop: '0.25rem' }}>90 days</div>
        </div>
      </Panel>
    </div>
  )
}
