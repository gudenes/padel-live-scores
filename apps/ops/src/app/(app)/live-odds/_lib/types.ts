// apps/ops/src/app/(app)/live-odds/_lib/types.ts
export type ConnectionState = 'loading' | 'live' | 'reconnecting' | 'offline'
export type Confidence = 'full' | 'med' | 'low'
export type MatchStatus = 'Live' | 'Break' | 'Scheduled'

export interface Pair { name: string; gender: 'men' | 'women'; serving: boolean }
export interface SetScore { a: number; b: number; current: boolean }

export interface Match {
  id: string
  pair1: Pair
  pair2: Pair
  tournament: string
  tournamentShort: string
  court: string
  round: string
  setScores: SetScore[]
  gamePoints: { a: string; b: string } | null
  status: MatchStatus
  scheduledTime?: string
  winProbA: number            // favorite-side % for pair1 (0–100)
  fairOddsA: number
  fairOddsB: number
  movement15m: number         // signed
  confidence: Confidence
  lastUpdatedSeconds: number
  winProbHistory: number[]    // capped at 30
  drivers?: {
    firstServe: [number, number]
    breakPts: [string, string]
    totalPts: [number, number]
  }
}

export interface Kpis {
  liveMatches: number
  preMatchModeled: number
  biggestSwing: { pct: number; label: string }
  lowCoverage: number
}

export interface LiveOddsSnapshot {
  matches: Match[]
  kpis: Kpis
}

export type Filters = {
  tournament: string | null
  gender: 'all' | 'men' | 'women'
  tier: string | null
  round: string | null
  status: 'all' | 'live' | 'break' | 'scheduled'
  swingingOnly: boolean
}
