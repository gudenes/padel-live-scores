// MIRROR of src/lib/odds/types.ts — keep byte-identical. Canonical copy is tested there.
// src/lib/odds/types.ts
// Self-contained: no @/ imports (mirrors byte-identically into padelgod).
export type Confidence = 'full' | 'med' | 'pre-match' | 'thin'

/** Favorite-agnostic live score, oriented to pair1/pair2 (1=pair1, 2=pair2). */
export interface ScoreState {
  setsWon: [number, number]            // completed sets [pair1, pair2]
  gamesInSet: [number, number]         // games in the current set
  currentGamePoints: [number, number]  // point counts in current game: 0,1,2,3 (=40), 4 (=AD)
  inTiebreak: boolean
  tiebreakPoints: [number, number]
  goldenPoint: boolean                 // true = no-ad (golden point) game rule
}

export interface OddsInput {
  rankings: [number | null, number | null, number | null, number | null]
  // [pair1p1, pair1p2, pair2p1, pair2p2] FIP rankings (lower = stronger), null if unknown
  score: ScoreState | null             // null = pre-match (prior only)
  pointByPoint: boolean                // true when live point data is flowing (drives confidence)
}

export interface OddsResult {
  pair1WinProb: number                 // 0..1
  pair2WinProb: number
  pair1FairOdds: number                // 1/p, rounded 2dp
  pair2FairOdds: number
  confidence: Confidence
}
