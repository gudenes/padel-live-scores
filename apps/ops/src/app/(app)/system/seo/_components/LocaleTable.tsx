// apps/ops/src/app/(app)/system/seo/_components/LocaleTable.tsx
import type { WindowDelta } from '@/lib/seo/seo-compute'

export interface LocaleRow {
  locale: 'en' | 'es' | 'pt' | 'it' | 'fr'
  clicks: number
  priorClicks: number
  delta: WindowDelta
  impressions: number
  avgPosition: number | null
}

const arrow = (d: WindowDelta) =>
  d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '—'
const arrowColor = (d: WindowDelta) =>
  d.direction === 'up' ? '#4ade80' : d.direction === 'down' ? '#f87171' : '#9ca3af'

export function LocaleTable({ rows }: { rows: LocaleRow[] }) {
  return (
    <section style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', opacity: 0.6, marginBottom: '0.5rem' }}>
        By locale · last 7 days
      </h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', opacity: 0.6, fontSize: '0.8rem' }}>
            <th style={{ padding: '0.5rem' }}>Locale</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Clicks</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Prior 7d</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Δ</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Impressions</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Position</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.locale} style={{ borderTop: '1px solid var(--border, #374151)' }}>
              <td style={{ padding: '0.5rem' }}>{r.locale}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.clicks.toLocaleString()}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right', opacity: 0.6 }}>{r.priorClicks.toLocaleString()}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right', color: arrowColor(r.delta) }}>
                {arrow(r.delta)} {Math.abs(r.delta.deltaPct)}%
              </td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.impressions.toLocaleString()}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                {r.avgPosition?.toFixed(1) ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
