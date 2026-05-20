// apps/ops/src/components/TodaySchedule.tsx
// 24h match schedule grouped by hour. Each bucket: hour, match count,
// round labels. Hour displayed in the user's local time (deriving from
// the UTC HH:MM the aggregator returns).

import type { TodayPayload } from '@/lib/today-aggregator'

function formatLocalHour(utcHHMM: string): string {
  const [h, m] = utcHHMM.split(':').map((s) => parseInt(s, 10))
  const today = new Date()
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), h ?? 0, m ?? 0))
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function TodaySchedule({ buckets }: { buckets: TodayPayload['schedule'] }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--status-neutral)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        Today's Schedule
      </div>
      {buckets.length === 0 ? (
        <div
          style={{
            padding: '32px 20px',
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--status-neutral)',
          }}
        >
          Nothing scheduled in the next 24 hours.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.hour} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td className="tabular" style={{ padding: '12px 20px', width: 100, fontWeight: 600 }}>
                  {formatLocalHour(b.hour)}
                </td>
                <td style={{ padding: '12px 20px', color: 'var(--status-neutral)' }}>
                  {b.roundLabels.length > 0 ? b.roundLabels.join(', ') : '—'}
                </td>
                <td className="tabular" style={{ padding: '12px 20px', textAlign: 'right' }}>
                  {b.matchCount} {b.matchCount === 1 ? 'match' : 'matches'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
