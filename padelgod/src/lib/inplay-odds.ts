// Analytic, serve-neutral padel-scoring win-probability + anchoring. Pure (no I/O).

export interface ScoreState {
  setsWon: [number, number]
  gamesInSet: [number, number]
  currentGamePoints: [number, number]  // 0,1,2,3(=40),4(=AD)
  inTiebreak: boolean
  tiebreakPoints: [number, number]
  goldenPoint: boolean
}

function deuceWin(p: number): number {
  const q = 1 - p
  return (p * p) / (p * p + q * q)
}

export function pWinGame(p: number, a: number, b: number, goldenPoint: boolean): number {
  const q = 1 - p
  const d = deuceWin(p)
  function rec(a: number, b: number): number {
    if (goldenPoint) {
      if (a >= 4) return 1
      if (b >= 4) return 0
      if (a === 3 && b === 3) return p
      return p * rec(a + 1, b) + q * rec(a, b + 1)
    }
    if (a >= 4 && a - b >= 2) return 1
    if (b >= 4 && b - a >= 2) return 0
    if (a >= 3 && b >= 3) {
      if (a === b) return d
      if (a === b + 1) return p + q * d
      if (b === a + 1) return p * d
    }
    return p * rec(a + 1, b) + q * rec(a, b + 1)
  }
  return rec(a, b)
}

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

export function pWinSetFromGames(p: number, ga: number, gb: number, goldenPoint: boolean): number {
  const G = pWinGame(p, 0, 0, goldenPoint)
  const memo = new Map<number, number>()
  function rec(ga: number, gb: number): number {
    if (ga >= 6 && ga - gb >= 2) return 1
    if (gb >= 6 && gb - ga >= 2) return 0
    if (ga === 6 && gb === 6) return pWinTiebreak(p, 0, 0)
    const key = ga * 100 + gb
    const cached = memo.get(key)
    if (cached !== undefined) return cached
    const v = G * rec(ga + 1, gb) + (1 - G) * rec(ga, gb + 1)
    memo.set(key, v)
    return v
  }
  return rec(ga, gb)
}

export function pWinMatchFromSets(p: number, sa: number, sb: number, goldenPoint: boolean): number {
  const S = pWinSetFromGames(p, 0, 0, goldenPoint)
  function rec(sa: number, sb: number): number {
    if (sa >= 2) return 1
    if (sb >= 2) return 0
    return S * rec(sa + 1, sb) + (1 - S) * rec(sa, sb + 1)
  }
  return rec(sa, sb)
}

function pCurrentSetWin(p: number, s: ScoreState): number {
  const [ga, gb] = s.gamesInSet
  if (s.inTiebreak) return pWinTiebreak(p, s.tiebreakPoints[0], s.tiebreakPoints[1])
  const gNow = pWinGame(p, s.currentGamePoints[0], s.currentGamePoints[1], s.goldenPoint)
  return gNow * pWinSetFromGames(p, ga + 1, gb, s.goldenPoint)
    + (1 - gNow) * pWinSetFromGames(p, ga, gb + 1, s.goldenPoint)
}

export function pWinMatchFav(p: number, s: ScoreState): number {
  const [sa, sb] = s.setsWon
  if (sa >= 2) return 1
  if (sb >= 2) return 0
  const setNow = pCurrentSetWin(p, s)
  return setNow * pWinMatchFromSets(p, sa + 1, sb, s.goldenPoint)
    + (1 - setNow) * pWinMatchFromSets(p, sa, sb + 1, s.goldenPoint)
}

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
