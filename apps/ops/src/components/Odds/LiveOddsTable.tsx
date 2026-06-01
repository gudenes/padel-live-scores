// apps/ops/src/components/Odds/LiveOddsTable.tsx
// Table of today's matches with per-match odds.

import { EmptyState } from '@/components/ui'
import { PairOddsRow } from './PairOddsRow'

export interface LiveMatchRow {
  match: {
    id: string
    category: string
    round: string | null
    round_canonical: string | null
    status: string
    scheduled_at: string
    court: string | null
    pair1_player1_id: string
    pair1_player2_id: string
    pair2_player1_id: string
    pair2_player2_id: string
    pair1_seed: number | null
    pair2_seed: number | null
  }
  prediction: {
    pair1_prob: number
    pair2_prob: number
    pair1_decimal_odds: number
    pair2_decimal_odds: number
    pair1_team_form: number
    pair2_team_form: number
    model_version: string
  } | null
  pair1Name: string
  pair2Name: string
}

export function LiveOddsTable({ rows }: { rows: LiveMatchRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="No in-scope matches scheduled for this day." />
  }

  return (
    <div style={{ border: '1px solid var(--border-card)', borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--bg-card)' }}>
      {rows.map(({ match, prediction, pair1Name, pair2Name }) => (
        <a
          key={match.id}
          href={`/odds/match/${match.id}`}
          style={{
            display: 'block',
            padding: 12,
            borderBottom: '1px solid var(--border-inner)',
            textDecoration: 'none',
            color: 'inherit',
            background: match.status === 'live' ? 'var(--orange-bg)' : undefined,
          }}
        >
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>
            <span>{match.scheduled_at?.slice(11, 16)}</span>
            <span>{match.court ?? '?'}</span>
            <span>{match.category}</span>
            <span>{match.round_canonical ?? match.round ?? '?'}</span>
            <span>{match.status}</span>
          </div>
          <PairOddsRow
            name={pair1Name}
            seed={match.pair1_seed}
            prob={prediction ? Number(prediction.pair1_prob) : undefined}
            decimal={prediction ? Number(prediction.pair1_decimal_odds) : undefined}
            form={prediction ? Number(prediction.pair1_team_form) : undefined}
            emphasis={prediction != null && Number(prediction.pair1_prob) > 0.5}
          />
          <PairOddsRow
            name={pair2Name}
            seed={match.pair2_seed}
            prob={prediction ? Number(prediction.pair2_prob) : undefined}
            decimal={prediction ? Number(prediction.pair2_decimal_odds) : undefined}
            form={prediction ? Number(prediction.pair2_team_form) : undefined}
            emphasis={prediction != null && Number(prediction.pair2_prob) > 0.5}
          />
        </a>
      ))}
    </div>
  )
}
