// apps/ops/src/components/TodaySchedule.tsx
// 24h match schedule grouped by hour. Each bucket: hour, match count,
// round labels. Hour displayed in the user's local time (deriving from
// the UTC HH:MM the aggregator returns).

import { Panel, DataTable, EmptyState } from '@/components/ui'
import type { TodayPayload } from '@/lib/today-aggregator'

function formatLocalHour(utcHHMM: string): string {
  const [h, m] = utcHHMM.split(':').map((s) => parseInt(s, 10))
  const today = new Date()
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), h ?? 0, m ?? 0))
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function TodaySchedule({ buckets }: { buckets: TodayPayload['schedule'] }) {
  return (
    <Panel title="Today's Schedule" padded={false}>
      {buckets.length === 0 ? (
        <EmptyState title="Nothing scheduled in the next 24 hours." />
      ) : (
        <DataTable>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.hour}>
                <td className="tabular" style={{ width: 100, fontWeight: 600 }}>
                  {formatLocalHour(b.hour)}
                </td>
                <td style={{ color: 'var(--text-3)' }}>
                  {b.roundLabels.length > 0 ? b.roundLabels.join(', ') : '—'}
                </td>
                <td className="tabular" style={{ textAlign: 'right' }}>
                  {b.matchCount} {b.matchCount === 1 ? 'match' : 'matches'}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Panel>
  )
}
