// Eligibility gates and candidate scoring for the market generator.
//
// The binding constraint on this product is liquidity per market, not
// database size. At ~40 daily actives making ~120 trades, 300 markets yields
// 0.4 trades each and every price sits frozen at its seed. These gates exist
// to keep the open-market count near `daily actives ÷ 10`.

export interface Candidate {
  /** Stable identity for dedup/logging, e.g. `${templateKey}:${matchId}`. */
  key: string
  matchId: string | null
  tournamentId: string | null
  category: 'men' | 'women' | null
  round: string | null
  /** Best (lowest) FIP ranking across the four players; null if unranked. */
  bestRanking: number | null
  /** Model probability for the YES side; null when no anchor exists. */
  modelProb: number | null
  scheduledAt: Date | null
}

export interface Gates {
  rounds?: string[]
  minRanking?: number
  /** Inclusive [lo, hi] band on modelProb. */
  competitiveness?: [number, number]
  dailyCap?: number
}

export type GateResult = { ok: true } | { ok: false; reason: string }

/** Round ordering for scoring. Higher is later in the draw. */
const ROUND_WEIGHT: Record<string, number> = {
  F: 100, SF: 80, QF: 60, R16: 45, R32: 30, R64: 20,
  Q3: 12, Q2: 8, Q1: 5,
}

export function passesGates(c: Candidate, g: Gates): GateResult {
  // A market with no anchor would open at a blank 50/50, which is the exact
  // cold-start failure this product is designed to avoid.
  if (c.modelProb === null) return { ok: false, reason: 'no seed price available' }

  // Without scheduled_at the market has no lock time and would trade forever.
  if (c.scheduledAt === null) return { ok: false, reason: 'no scheduled_at' }

  if (g.rounds && g.rounds.length > 0) {
    if (!c.round || !g.rounds.includes(c.round)) {
      return { ok: false, reason: 'below round gate' }
    }
  }

  if (typeof g.minRanking === 'number') {
    if (c.bestRanking === null || c.bestRanking > g.minRanking) {
      return { ok: false, reason: `no top-${g.minRanking} player` }
    }
  }

  if (g.competitiveness) {
    const [lo, hi] = g.competitiveness
    if (c.modelProb < lo || c.modelProb > hi) {
      return { ok: false, reason: 'outside competitiveness band' }
    }
  }

  return { ok: true }
}

/**
 * Higher is more worth opening. Used to pick the top N when more candidates
 * survive the gates than the caps allow.
 */
export function scoreCandidate(c: Candidate): number {
  const roundScore = c.round ? (ROUND_WEIGHT[c.round] ?? 10) : 10

  // Rank 1 → 50 points, rank 50 → ~13, unranked → 0.
  const rankScore = c.bestRanking === null ? 0 : 50 / Math.log2(c.bestRanking + 2) * 0.6

  // A coin flip is the most interesting market; 0.5 → 40, 0.65 → 28.
  const closeness = c.modelProb === null ? 0 : (1 - Math.abs(c.modelProb - 0.5) * 2) * 40

  return roundScore + rankScore + closeness
}
