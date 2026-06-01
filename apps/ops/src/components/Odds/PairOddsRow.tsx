// apps/ops/src/components/Odds/PairOddsRow.tsx
// Renders one pair's display info (names, seed, prob, decimal, form).
// Used by LiveOddsTable and TournamentOutlookCard.

import type { ReactNode } from 'react'

export interface PairOddsRowProps {
  name: string
  seed?: number | null
  prob?: number       // 0-1
  decimal?: number
  form?: number       // can be positive or negative
  emphasis?: boolean  // highlight as favorite
}

export function PairOddsRow({ name, seed, prob, decimal, form, emphasis }: PairOddsRowProps) {
  const formChip = form != null ? renderFormChip(form) : null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: emphasis ? 600 : 400 }}>
      {seed ? <span style={{ fontSize: 11, color: 'var(--text-3)' }}>[{seed}]</span> : null}
      <span style={{ flex: 1 }}>{name}</span>
      {prob != null && <span style={{ minWidth: 56, textAlign: 'right' }}>{(prob * 100).toFixed(1)}%</span>}
      {decimal != null && (
        <span style={{ minWidth: 56, textAlign: 'right', color: 'var(--lime-text)' }}>
          {decimal.toFixed(2)}
        </span>
      )}
      {formChip}
    </div>
  )
}

function renderFormChip(form: number): ReactNode {
  const rounded = Math.round(form)
  const sign = rounded > 0 ? '+' : ''
  const color =
    rounded > 20 ? 'var(--lime-text)' :
    rounded < -20 ? 'var(--live-text)' :
    'var(--text-3)'
  return (
    <span style={{ minWidth: 36, fontSize: 11, color, textAlign: 'right' }}>
      {sign}{rounded}
    </span>
  )
}
