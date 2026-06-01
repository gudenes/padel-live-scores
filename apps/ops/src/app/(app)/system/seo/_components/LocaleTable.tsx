// apps/ops/src/app/(app)/system/seo/_components/LocaleTable.tsx
import { Panel, DataTable } from '@/components/ui'
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
  d.direction === 'up' ? 'var(--lime-text)' : d.direction === 'down' ? 'var(--live-text)' : 'var(--text-3)'

export function LocaleTable({ rows }: { rows: LocaleRow[] }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <Panel title="By locale · last 7 days" padded={false}>
        <DataTable>
          <thead>
            <tr>
              <th>Locale</th>
              <th style={{ textAlign: 'right' }}>Clicks</th>
              <th style={{ textAlign: 'right' }}>Prior 7d</th>
              <th style={{ textAlign: 'right' }}>Δ</th>
              <th style={{ textAlign: 'right' }}>Impressions</th>
              <th style={{ textAlign: 'right' }}>Position</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.locale}>
                <td style={{ fontWeight: 500 }}>{r.locale}</td>
                <td style={{ textAlign: 'right' }}>{r.clicks.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-3)' }}>{r.priorClicks.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: arrowColor(r.delta), fontWeight: 500 }}>
                  {arrow(r.delta)} {Math.abs(r.delta.deltaPct)}%
                </td>
                <td style={{ textAlign: 'right' }}>{r.impressions.toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>
                  {r.avgPosition?.toFixed(1) ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>
    </div>
  )
}
