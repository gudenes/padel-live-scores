// apps/ops/src/components/TodayLiveNow.tsx
// Currently-live matches as a compact table. Pulsing LIVE pill, court,
// pair vs pair, score, elapsed time. Per the spec's screen-1 mockup.

import { Panel, DataTable, EmptyState, Pill } from '@/components/ui'
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
    <Panel
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Pill tone="live" dot pulse>
            LIVE NOW
          </Pill>
          <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>{matches.length} matches</span>
        </span>
      }
      padded={false}
    >
      {matches.length === 0 ? (
        <EmptyState title="No live matches right now." />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>Court</th>
              <th>Pair 1</th>
              <th>Pair 2</th>
              <th>Score</th>
              <th style={{ textAlign: 'right' }}>Elapsed</th>
            </tr>
          </thead>
          <tbody>
            {matches.slice(0, 8).map((m) => (
              <tr key={m.matchId}>
                <td style={{ color: 'var(--text-3)' }}>{m.court ?? '—'}</td>
                <td>{m.pair1}</td>
                <td>{m.pair2}</td>
                <td className="tabular">{m.setScores.join(' · ') || '—'}</td>
                <td className="tabular" style={{ textAlign: 'right', color: 'var(--text-3)' }}>
                  {elapsedLabel(m.startedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Panel>
  )
}
