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
  d.direction === 'up' ? '#16a34a' : d.direction === 'down' ? '#dc2626' : '#6b7280'

export function HeadlineTile({ currentClicks, priorClicks, delta, sparklineData }: Props) {
  return (
    <section style={{
      padding: '1.5rem',
      borderRadius: 12,
      background: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      marginBottom: '1.5rem',
    }}>
      <div style={{
        fontSize: '0.75rem',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: '#6b7280',
        marginBottom: '0.5rem',
      }}>
        Clicks · last 7 days
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
        <div style={{ fontSize: '2.5rem', fontWeight: 600, color: 'var(--brand-primary-fg)' }}>
          {currentClicks.toLocaleString()}
        </div>
        <div style={{ color: arrowColor(delta), fontWeight: 600, fontSize: '1rem' }}>
          {arrow(delta)} {Math.abs(delta.deltaPct)}%
        </div>
        <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>
          vs {priorClicks.toLocaleString()} prior 7d
        </div>
      </div>
      <div style={{ marginTop: '0.75rem' }}>
        <Sparkline data={sparklineData} />
        <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.25rem' }}>90 days</div>
      </div>
    </section>
  )
}
