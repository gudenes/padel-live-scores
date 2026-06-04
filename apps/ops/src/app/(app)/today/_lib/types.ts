// apps/ops/src/app/(app)/today/_lib/types.ts
// The typed data contract for the Today scoreboard. Pure types, no runtime.

export type ConnectionState = 'loading' | 'live' | 'reconnecting' | 'offline'
export type Confidence = 'full' | 'med' | 'low'
export type MatchStatus = 'live' | 'break' | 'scheduled' | 'finished'
export type AnchorSource = 'model-prediction' | 'cold-start-elo'

export interface Pair {
  name: string            // short display name (last token), e.g. "Di Nenno / Navarro"
  player1Name: string
  player2Name: string
  gender: 'men' | 'women'
  serving: boolean        // true if this pair is currently serving (live only)
}

export interface SetScore { a: number; b: number; current: boolean }

export interface Match {
  id: string
  pair1: Pair
  pair2: Pair
  tournament: string
  court: string | null
  round: string | null
  tier: string | null            // tournaments.level
  status: MatchStatus
  scheduledAt: string | null     // ISO
  setScores: SetScore[]
  gamePoints: { a: string; b: string } | null  // null when break/scheduled
  winProb1: number               // pair1 win prob 0-1
  fairOdds1: number
  fairOdds2: number
  movement15m: number            // signed delta in pair1 prob over ~15m (0 if unknown)
  confidence: Confidence
  anchorSource: AnchorSource | null
  lastUpdatedSeconds: number     // now - computed_at (0 for scheduled)
  winProbHistory: number[]       // pair1 prob series, oldest→newest, cap 30 (live only)
  currentSetStartedAt: string | null  // ISO, for the chart's Set view (live only)
  winnerPair: 1 | 2 | null       // winning pair for finished matches; null otherwise
}

export interface KpiData {
  liveMatches: number
  preMatchModeled: number
  biggestSwing: { pct: number; label: string }   // signed pct (×100), match label
  lowCoverage: number
}

export interface LiveOddsSnapshot {
  matches: Match[]
  kpis: KpiData
  fetchedAt: string  // ISO
}
