// MIRROR of src/lib/odds/scoring.ts — keep byte-identical. Canonical copy is tested there.
// Analytic padel scoring win-probability. Serve-neutral: a single per-point
// probability `p` for the favorite. Self-contained (no imports) for mirroring.
import type { ScoreState } from './types.js'

function deuceWin(p: number): number {
  const q = 1 - p
  return (p * p) / (p * p + q * q) // P(win | at deuce)
}

/** P(favorite wins a game) from point counts a..b. goldenPoint = no-ad rule. */
export function pWinGame(p: number, a: number, b: number, goldenPoint: boolean): number {
  const q = 1 - p
  const d = deuceWin(p)
  function rec(a: number, b: number): number {
    if (goldenPoint) {
      if (a >= 4) return 1
      if (b >= 4) return 0
      if (a === 3 && b === 3) return p // golden point decides
      return p * rec(a + 1, b) + q * rec(a, b + 1)
    }
    if (a >= 4 && a - b >= 2) return 1
    if (b >= 4 && b - a >= 2) return 0
    if (a >= 3 && b >= 3) {
      if (a === b) return d
      if (a === b + 1) return p + q * d // advantage favorite
      if (b === a + 1) return p * d // advantage opponent
    }
    return p * rec(a + 1, b) + q * rec(a, b + 1)
  }
  return rec(a, b)
}

/** P(favorite wins a tiebreak) from points a..b (first to 7, win by 2). */
export function pWinTiebreak(p: number, a: number, b: number): number {
  const q = 1 - p
  const d = deuceWin(p)
  function rec(a: number, b: number): number {
    if (a >= 7 && a - b >= 2) return 1
    if (b >= 7 && b - a >= 2) return 0
    if (a >= 6 && b >= 6) {
      if (a === b) return d
      if (a === b + 1) return p + q * d
      if (b === a + 1) return p * d
    }
    return p * rec(a + 1, b) + q * rec(a, b + 1)
  }
  return rec(a, b)
}

/** P(favorite wins a full set) from games ga..gb (current game already resolved). */
export function pWinSetFromGames(p: number, ga: number, gb: number, goldenPoint: boolean): number {
  const G = pWinGame(p, 0, 0, goldenPoint) // full game from scratch
  const cache = new Map<number, number>()
  function rec(ga: number, gb: number): number {
    if (ga >= 6 && ga - gb >= 2) return 1
    if (gb >= 6 && gb - ga >= 2) return 0
    if (ga === 6 && gb === 6) return pWinTiebreak(p, 0, 0)
    const key = ga * 100 + gb
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const result = G * rec(ga + 1, gb) + (1 - G) * rec(ga, gb + 1)
    cache.set(key, result)
    return result
  }
  return rec(ga, gb)
}

/** P(favorite wins best-of-3) from completed sets sa..sb (current set already resolved). */
export function pWinMatchFromSets(p: number, sa: number, sb: number, goldenPoint: boolean): number {
  const S = pWinSetFromGames(p, 0, 0, goldenPoint) // full set from scratch
  function rec(sa: number, sb: number): number {
    if (sa >= 2) return 1
    if (sb >= 2) return 0
    return S * rec(sa + 1, sb) + (1 - S) * rec(sa, sb + 1)
  }
  return rec(sa, sb)
}

/** P(favorite wins the current set) incorporating current games + current game/tiebreak points. */
function pCurrentSetWin(p: number, s: ScoreState): number {
  const [ga, gb] = s.gamesInSet
  if (s.inTiebreak) return pWinTiebreak(p, s.tiebreakPoints[0], s.tiebreakPoints[1])
  const gNow = pWinGame(p, s.currentGamePoints[0], s.currentGamePoints[1], s.goldenPoint)
  return gNow * pWinSetFromGames(p, ga + 1, gb, s.goldenPoint)
    + (1 - gNow) * pWinSetFromGames(p, ga, gb + 1, s.goldenPoint)
}

/** Full match-win probability for the FAVORITE. `s` must already be oriented to the favorite. */
export function pWinMatchFav(p: number, s: ScoreState): number {
  const setNow = pCurrentSetWin(p, s)
  const [sa, sb] = s.setsWon
  return setNow * pWinMatchFromSets(p, sa + 1, sb, s.goldenPoint)
    + (1 - setNow) * pWinMatchFromSets(p, sa, sb + 1, s.goldenPoint)
}

/** Binary-search the per-point probability p so the 0-0 match prob equals `target`. */
export function anchorPerPoint(target: number, goldenPoint: boolean): number {
  const zero: ScoreState = {
    setsWon: [0, 0], gamesInSet: [0, 0], currentGamePoints: [0, 0],
    inTiebreak: false, tiebreakPoints: [0, 0], goldenPoint,
  }
  let lo = 0.5, hi = 1 - 1e-9
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (pWinMatchFav(mid, zero) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
