// src/lib/odds/index.ts
// Public entry point for the win-probability model.
// Self-contained: no @/ imports (mirrors byte-identically into padelgod).
import type { OddsInput, OddsResult, ScoreState, Confidence } from './types'
import { preMatchProb, fairOdds } from './prematch'
import { anchorPerPoint, pWinMatchFav } from './scoring'

/** Flip a pair1-oriented score so the favorite is the "a" side. */
function orientToFavorite(s: ScoreState, favorite: 1 | 2): ScoreState {
  if (favorite === 1) return s
  const swap = ([a, b]: [number, number]): [number, number] => [b, a]
  return {
    setsWon: swap(s.setsWon),
    gamesInSet: swap(s.gamesInSet),
    currentGamePoints: swap(s.currentGamePoints),
    inTiebreak: s.inTiebreak,
    tiebreakPoints: swap(s.tiebreakPoints),
    goldenPoint: s.goldenPoint,
  }
}

export function computeOdds(input: OddsInput): OddsResult {
  const prior = preMatchProb(input.rankings)
  // pair1 win prob first, then optionally move it live.
  let p1: number
  if (input.score === null) {
    p1 = prior.p1
  } else {
    const favorite: 1 | 2 = prior.p1 >= prior.p2 ? 1 : 2
    const target = Math.max(prior.p1, prior.p2)               // favorite's prior
    const p = anchorPerPoint(target, input.score.goldenPoint) // per-point prob
    const favProb = pWinMatchFav(p, orientToFavorite(input.score, favorite))
    p1 = favorite === 1 ? favProb : 1 - favProb
  }
  const p2 = 1 - p1

  let confidence: Confidence
  if (prior.fallback) confidence = 'thin'
  else if (input.score === null) confidence = 'pre-match'
  else confidence = input.pointByPoint ? 'full' : 'med'

  return {
    pair1WinProb: p1,
    pair2WinProb: p2,
    pair1FairOdds: fairOdds(p1),
    pair2FairOdds: fairOdds(p2),
    confidence,
  }
}
