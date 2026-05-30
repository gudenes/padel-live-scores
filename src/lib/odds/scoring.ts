// Analytic padel scoring win-probability. Serve-neutral: a single per-point
// probability `p` for the favorite. Self-contained (no imports) for mirroring.

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
