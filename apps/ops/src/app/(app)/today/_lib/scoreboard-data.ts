// apps/ops/src/app/(app)/today/_lib/scoreboard-data.ts
import type { Match, MatchStatus, AnchorSource } from './types'
import { movement15m, capHistory, coverageToConfidence, type ProbPoint } from './movement'
import { splitGameScore } from './score'

export function shortName(name: string | null | undefined): string {
  if (!name) return '—'
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1] || '—'
}

const pairName = (a: string | null, b: string | null) =>
  [shortName(a), shortName(b)].filter((x) => x !== '—').join(' / ') || 'TBD'

const statusOf = (s: string): MatchStatus =>
  s === 'break' ? 'break' : s === 'live' || s === 'on_court' ? 'live' : 'scheduled'

// Shape of a match_live_odds row joined to match/player/tournament display fields.
export interface LiveOddsRow {
  match_id: string
  pair1_prob: number; pair2_prob: number
  pair1_decimal_odds: number; pair2_decimal_odds: number
  anchor_source: AnchorSource
  coverage: 'live-pbp' | 'live-coarse'
  computed_at: string
  matches: {
    status: string; court: string | null; round_canonical: string | null; category: string
    tournament: { name: string | null; level: string | null } | null
    p1a: { id: string; name: string | null } | null
    p1b: { id: string; name: string | null } | null
    p2a: { id: string; name: string | null } | null
    p2b: { id: string; name: string | null } | null
  } | null
}

export interface LiveExtras {
  sets: Array<{ pair1_games: number; pair2_games: number; is_current: boolean }>
  gameScore: string | null
  servingPlayerId: string | null
  history: ProbPoint[]
  currentSetStartedAt: string | null
}

export function mapLiveRowToMatch(row: LiveOddsRow, extra: LiveExtras, nowMs: number): Match {
  const m = row.matches
  const serving = extra.servingPlayerId
  const p1a = m?.p1a?.id, p1b = m?.p1b?.id
  const servingPair1 = serving != null && (serving === p1a || serving === p1b)
  const servingPair2 = serving != null && (serving === m?.p2a?.id || serving === m?.p2b?.id)
  const status = statusOf(m?.status ?? 'scheduled')
  return {
    id: row.match_id,
    pair1: {
      name: pairName(m?.p1a?.name ?? null, m?.p1b?.name ?? null),
      player1Name: m?.p1a?.name ?? 'TBD', player2Name: m?.p1b?.name ?? 'TBD',
      gender: (m?.category === 'women' ? 'women' : 'men'),
      serving: status !== 'scheduled' && servingPair1,
    },
    pair2: {
      name: pairName(m?.p2a?.name ?? null, m?.p2b?.name ?? null),
      player1Name: m?.p2a?.name ?? 'TBD', player2Name: m?.p2b?.name ?? 'TBD',
      gender: (m?.category === 'women' ? 'women' : 'men'),
      serving: status !== 'scheduled' && servingPair2,
    },
    tournament: m?.tournament?.name ?? 'Unknown',
    court: m?.court ?? null,
    round: m?.round_canonical ?? null,
    tier: m?.tournament?.level ?? null,
    status,
    scheduledAt: null,
    setScores: extra.sets.map((s) => ({ a: s.pair1_games, b: s.pair2_games, current: s.is_current })),
    gamePoints: status === 'live' ? splitGameScore(extra.gameScore) : null,
    winProb1: Number(row.pair1_prob),
    fairOdds1: Number(row.pair1_decimal_odds),
    fairOdds2: Number(row.pair2_decimal_odds),
    movement15m: movement15m(extra.history, nowMs),
    confidence: coverageToConfidence(row.coverage),
    anchorSource: row.anchor_source,
    lastUpdatedSeconds: Math.max(0, Math.round((nowMs - +new Date(row.computed_at)) / 1000)),
    winProbHistory: capHistory(extra.history.map((h) => h.prob), 30),
    currentSetStartedAt: extra.currentSetStartedAt,
  }
}
