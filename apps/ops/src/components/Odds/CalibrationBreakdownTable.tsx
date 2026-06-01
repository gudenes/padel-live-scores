// apps/ops/src/components/Odds/CalibrationBreakdownTable.tsx
// Tabular calibration breakdown — by tier or by tournament.

import { DataTable, EmptyState } from '@/components/ui'

export interface CalibrationBreakdownRow {
  key: string             // tier name or tournament name
  count: number
  meanBrier: number
  meanLogLoss: number
  favoriteHitRate: number
}

export function CalibrationBreakdownTable({
  title,
  rows,
}: {
  title: string
  rows: CalibrationBreakdownRow[]
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>{title}</h3>
      {rows.length === 0 ? (
        <EmptyState title="No data yet." />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Group</th>
              <th style={{ textAlign: 'right' }}>Scored</th>
              <th style={{ textAlign: 'right' }}>Mean Brier</th>
              <th style={{ textAlign: 'right' }}>Mean log-loss</th>
              <th style={{ textAlign: 'right' }}>Fav hit-rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.key}</td>
                <td style={{ textAlign: 'right' }}>{r.count}</td>
                <td style={{ textAlign: 'right' }}>{r.meanBrier.toFixed(4)}</td>
                <td style={{ textAlign: 'right' }}>{r.meanLogLoss.toFixed(4)}</td>
                <td style={{ textAlign: 'right' }}>{(r.favoriteHitRate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  )
}
