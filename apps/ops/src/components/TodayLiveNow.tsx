// apps/ops/src/components/TodayLiveNow.tsx
// Currently-live matches as a compact table. Pulsing LIVE pill, court,
// pair vs pair, score, elapsed time. Per the spec's screen-1 mockup.

import type { TodayPayload } from '@/lib/today-aggregator'

function elapsedLabel(startedAt: string | null): string {
  if (!startedAt) return '—'
  const ms = Date.now() - new Date(startedAt).getTime()
  if (ms < 0) return '—'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  return `${hours}h${remMins ? ` ${remMins}m` : ''}`
}

export function TodayLiveNow({ matches }: { matches: TodayPayload['liveNow'] }) {
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
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          className="live-pulse"
          style={{
            background: 'var(--status-live)',
            color: 'var(--bg-card)',
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          LIVE NOW
        </span>
        <span style={{ color: 'var(--brand-primary-fg)' }}>{matches.length} matches</span>
      </div>

      {matches.length === 0 ? (
        <div
          style={{
            padding: '32px 20px',
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--status-neutral)',
          }}
        >
          No live matches right now.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: 'var(--status-neutral)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <th style={{ textAlign: 'left', padding: '8px 20px', fontWeight: 600 }}>Court</th>
              <th style={{ textAlign: 'left', padding: '8px 20px', fontWeight: 600 }}>Pair 1</th>
              <th style={{ textAlign: 'left', padding: '8px 20px', fontWeight: 600 }}>Pair 2</th>
              <th style={{ textAlign: 'left', padding: '8px 20px', fontWeight: 600 }}>Score</th>
              <th style={{ textAlign: 'right', padding: '8px 20px', fontWeight: 600 }}>Elapsed</th>
            </tr>
          </thead>
          <tbody>
            {matches.slice(0, 8).map((m) => (
              <tr key={m.matchId} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '10px 20px', color: 'var(--status-neutral)' }}>{m.court ?? '—'}</td>
                <td style={{ padding: '10px 20px', color: 'var(--brand-primary-fg)' }}>{m.pair1}</td>
                <td style={{ padding: '10px 20px', color: 'var(--brand-primary-fg)' }}>{m.pair2}</td>
                <td className="tabular" style={{ padding: '10px 20px', color: 'var(--brand-primary-fg)' }}>
                  {m.setScores.join(' · ') || '—'}
                </td>
                <td className="tabular" style={{ padding: '10px 20px', textAlign: 'right', color: 'var(--status-neutral)' }}>
                  {elapsedLabel(m.startedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
