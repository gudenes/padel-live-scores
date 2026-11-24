/** Labels only: qualifying destinations must come from a validated full draw. */
export function canonicalPointsRound(round?: string | null): string | null {
  const value = round?.trim().toUpperCase().replace(/\s+/g, ' ')
  if (!value) return null
  const fraction = ({ '1/2': 'SF', '1/4': 'QF', '1/8': 'R16', '1/16': 'R32', '1/32': 'R64', '1/64': 'R128' } as Record<string, string>)[value]
  if (fraction) return fraction
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
