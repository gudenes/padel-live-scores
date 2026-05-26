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
  d.direction === 'up' ? '#16a34a' : d.direction === 'down' ? '#dc2626' : '#6b7280'

export function LocaleTable({ rows }: { rows: LocaleRow[] }) {
  return (
    <section style={{
      marginBottom: '1.5rem',
      padding: '1.25rem',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 12,
    }}>
      <h3 style={{
        fontSize: '0.75rem',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: '#6b7280',
        marginTop: 0,
        marginBottom: '0.75rem',
      }}>
        By locale · last 7 days
      </h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#6b7280', fontSize: '0.8rem' }}>
            <th style={{ padding: '0.5rem', fontWeight: 500 }}>Locale</th>
            <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>Clicks</th>
            <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>Prior 7d</th>
            <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>Δ</th>
            <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>Impressions</th>
            <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>Position</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.locale} style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '0.5rem', fontWeight: 500 }}>{r.locale}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.clicks.toLocaleString()}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right', color: '#6b7280' }}>{r.priorClicks.toLocaleString()}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right', color: arrowColor(r.delta), fontWeight: 500 }}>
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
