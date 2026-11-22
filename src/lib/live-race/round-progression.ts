/** Labels only: qualifying destinations must come from a validated full draw. */
export function canonicalPointsRound(round?: string | null): string | null {
  const value = round?.trim().toUpperCase()
  if (!value) return null
  if (/^Q[1-4]$/.test(value)) return value
  if (/^(F|FINALS?)$/.test(value)) return 'F'
  if (/^(SF|SEMI[ -]?FINALS?)$/.test(value)) return 'SF'
  if (/^(QF|QUARTER[ -]?FINALS?)$/.test(value)) return 'QF'
  const numbered = /^(?:R|ROUND OF )(16|32|64|128)$/.exec(value)
  return numbered ? `R${numbered[1]}` : null
}

export function mainDrawDestination(round?: string | null): string | null {
  const current = canonicalPointsRound(round)
  return current ? ({ R128: 'R64', R64: 'R32', R32: 'R16', R16: 'QF', QF: 'SF', SF: 'F', F: 'W' } as Record<string, string>)[current] ?? null : null
}
