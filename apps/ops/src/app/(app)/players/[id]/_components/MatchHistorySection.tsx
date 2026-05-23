'use client'
// apps/ops/src/app/(app)/players/[id]/_components/MatchHistorySection.tsx
// Table of the player's last 50 matches with W/L outcome derived from
// winner_pair vs the player's pair position. The aggregator already orders
// by scheduled_at DESC and caps at 50, so this component is pure rendering.
//
// W/L logic: only labelled when the match has reached a terminal state
// ('finished' / 'walkover' / 'retired') AND `winner_pair` is set. Otherwise
// we render an em-dash to avoid implying a result for live or scheduled rows.

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
      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Match history</h2>
        <div className="text-xs text-gray-400">No matches found.</div>
      </section>
    )
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">
        Match history ({matches.length})
      </h2>
      <table className="w-full text-xs">
        <thead className="text-gray-500 border-b border-gray-100">
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
              <tr key={m.id} className="border-b border-gray-50">
                <td className="py-1.5 text-gray-600">
                  {m.scheduled_at?.slice(0, 10) ?? '—'}
                </td>
                <td className="text-gray-900">{m.tournament?.name ?? '—'}</td>
                <td className="text-gray-500">{m.round ?? '—'}</td>
                <td
                  className={
                    result === 'W'
                      ? 'text-green-600 font-semibold'
                      : 'text-gray-500'
                  }
                >
                  {result}
                </td>
                <td className="text-gray-400">{m.status}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
