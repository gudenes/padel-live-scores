// apps/ops/src/components/Odds/CalibrationBreakdownTable.tsx
// Tabular calibration breakdown — by tier or by tournament.

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
        <div style={{ color: 'var(--status-neutral)', fontSize: 13 }}>No data yet.</div>
      ) : (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <th style={{ textAlign: 'left', padding: 6 }}>Group</th>
              <th style={{ textAlign: 'right', padding: 6 }}>Scored</th>
              <th style={{ textAlign: 'right', padding: 6 }}>Mean Brier</th>
              <th style={{ textAlign: 'right', padding: 6 }}>Mean log-loss</th>
              <th style={{ textAlign: 'right', padding: 6 }}>Fav hit-rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: 6 }}>{r.key}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{r.count}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{r.meanBrier.toFixed(4)}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{r.meanLogLoss.toFixed(4)}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{(r.favoriteHitRate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
