// Pure derivations for the amateur profile.
//
// The SNP source gives us, per court: who was on it, whether it was won,
// and how many sets it lasted — but not the opponent, not a set score, and
// not always which two of the listed players actually partnered. Anything
// derived here has to survive that: a partner is only "confirmed" when the
// slot held exactly one court.

export interface AmateurGame {
  fixtureCode: string
  /** Court block value: 3 = courts 1-2, 2 = courts 3-5. */
  worth: number
  result: 'W' | 'L' | null
  sets: number | null
  /** True when the slot maps to a single court, so the pairing is certain. */
  exact: boolean
  /** False for partially-recorded rounds (J10, playoff) — still counted. */
  complete: boolean
  /** Everyone else listed on the slot, excluding the profile's own player. */
  partnerIds: string[]
}

export interface AmateurRecord {
  played: number
  wins: number
  losses: number
  /** Whole-number percentage, or null when no games were played. */
  winRate: number | null
}

export function computeRecord(games: AmateurGame[]): AmateurRecord {
  const played = games.length
  const wins = games.filter(g => g.result === 'W').length
  const losses = games.filter(g => g.result === 'L').length
  return {
    played,
    wins,
    losses,
    winRate: played > 0 ? Math.round((wins / played) * 100) : null,
  }
}

export interface UsualCourt {
  worth: number
  count: number
  total: number
}

/**
 * The court block the player was fielded on most. Ties go to the higher-value
 * block, because being trusted on a 3-point court is the more notable fact.
 */
export function computeUsualCourt(games: AmateurGame[]): UsualCourt | null {
  if (games.length === 0) return null
  const counts = new Map<number, number>()
  for (const g of games) counts.set(g.worth, (counts.get(g.worth) ?? 0) + 1)
  let best: UsualCourt | null = null
  for (const [worth, count] of counts) {
    if (best == null || count > best.count || (count === best.count && worth > best.worth)) {
      best = { worth, count, total: games.length }
    }
  }
  return best
}

export interface AmateurPartners {
  /** Sorted player ids we know the player partnered with. */
  confirmed: string[]
  /** Sorted player ids who *may* have partnered — ambiguous slots only. */
  probable: string[]
}

export function collectPartners(games: AmateurGame[]): AmateurPartners {
  const confirmed = new Set<string>()
  const maybe = new Set<string>()
  for (const g of games) {
    for (const id of g.partnerIds) {
      if (g.exact && g.partnerIds.length === 1) confirmed.add(id)
      else maybe.add(id)
    }
  }
  // A confirmed pairing outranks an ambiguous appearance elsewhere.
  for (const id of confirmed) maybe.delete(id)
  return {
    confirmed: [...confirmed].sort(),
    probable: [...maybe].sort(),
  }
}
