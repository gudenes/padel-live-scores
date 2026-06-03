'use client'
// apps/ops/src/app/(app)/players/[id]/_components/MatchHistorySection.tsx
// Table of the player's last 50 matches with W/L outcome derived from
// winner_pair vs the player's pair position. The aggregator already orders
// by scheduled_at DESC and caps at 50, so this component is pure rendering.
//
// W/L logic: only labelled when the match has reached a terminal state
// ('finished' / 'walkover' / 'retired') AND `winner_pair` is set. Otherwise
// we render an em-dash to avoid implying a result for live or scheduled rows.

import { Panel } from '@/components/ui'

export interface MatchHistoryRow {
  id: string
  scheduled_at: string | null
  status: string
  winner_pair: number | null
  round: string | null
  tournament: { id: string; name: string; logo_url: string | null } | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
}

function pairOf(m: MatchHistoryRow, playerId: string): 1 | 2 | null {
  // Returns 1 or 2 if the player is in that pair, null otherwise.
  // The aggregator's OR clause should always place the player in one of the
  // four slots, but if data drifts we'd rather render '—' than mislabel an
  // absent player as W/L.
  if (m.pair1_player1_id === playerId || m.pair1_player2_id === playerId) return 1
  if (m.pair2_player1_id === playerId || m.pair2_player2_id === playerId) return 2
  return null
}

function outcomeLabel(m: MatchHistoryRow, playerId: string): 'W' | 'L' | '—' {
  if (m.status !== 'finished' && m.status !== 'walkover' && m.status !== 'retired') {
    return '—'
  }
  if (m.winner_pair == null) return '—'
  const pair = pairOf(m, playerId)
  if (pair == null) return '—'
  return m.winner_pair === pair ? 'W' : 'L'
}

export default function MatchHistorySection({
  playerId,
  matches,
}: {
  playerId: string
  matches: MatchHistoryRow[]
}) {
  if (matches.length === 0) {
    return (
      <Panel title="Match history">
        <div className="text-xs" style={{ color: 'var(--text-3)' }}>
          No matches found.
        </div>
      </Panel>
    )
  }

  return (
    <Panel title={`Match history (${matches.length})`}>
      <table className="w-full text-xs">
        <thead
          className="border-b"
          style={{ color: 'var(--text-3)', borderColor: 'var(--border-inner)' }}
        >
          <tr>
            <th className="text-left font-medium py-1.5">Date</th>
            <th className="text-left font-medium">Tournament</th>
            <th className="text-left font-medium">Round</th>
            <th className="text-left font-medium">Result</th>
            <th className="text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => {
            const result = outcomeLabel(m, playerId)
            return (
              <tr
                key={m.id}
                className="border-b"
                style={{ borderColor: 'var(--border-inner)' }}
              >
                <td className="py-1.5" style={{ color: 'var(--text-2)' }}>
                  {m.scheduled_at?.slice(0, 10) ?? '—'}
                </td>
                <td style={{ color: 'var(--text-1)' }}>
                  {m.tournament?.name ?? '—'}
                </td>
                <td style={{ color: 'var(--text-3)' }}>{m.round ?? '—'}</td>
                <td
                  className={result === 'W' ? 'font-semibold' : undefined}
                  style={{
                    color: result === 'W' ? 'var(--lime-text)' : 'var(--text-3)',
                  }}
                >
                  {result}
                </td>
                <td style={{ color: 'var(--text-3)' }}>{m.status}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Panel>
  )
}
