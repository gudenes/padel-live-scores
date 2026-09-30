// Localized copy for `play_result` inbox notifications.
//
// `play_settle_market` (SQL) writes the notification's title/body in English,
// and NotificationRow renders stored text verbatim. Rather than rewrite the
// money-moving settlement function for copy, the row is re-rendered at display
// time from what it already carries: `metadata.delta` / `metadata.revision`,
// and the outcome — `metadata.outcome` when present, else parsed from the
// fixed-format body the function writes ("Outcome: yes. Balance adjustment: …").

export type PlayOutcome = 'yes' | 'no' | 'void'

export interface PlayResultNotice {
  corrected: boolean
  outcome: PlayOutcome
  delta: number
}

const OUTCOME_RE = /^Outcome: (yes|no|void)\./

export function parsePlayResultNotice(row: {
  category: string
  body: string | null
  metadata: Record<string, unknown> | null
}): PlayResultNotice | null {
  if (row.category !== 'play_result') return null
  const m = row.metadata ?? {}
  const delta = Number(m.delta)
  if (!Number.isFinite(delta)) return null
  const fromMeta = typeof m.outcome === 'string' ? m.outcome : null
  const outcome = (fromMeta ?? OUTCOME_RE.exec(row.body ?? '')?.[1] ?? null) as PlayOutcome | null
  if (outcome !== 'yes' && outcome !== 'no' && outcome !== 'void') return null
  return { corrected: Number(m.revision) > 1, outcome, delta }
}
