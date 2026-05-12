// src/lib/match-quality.ts
//
// Pure scoring function for upcoming padel matches.
// 0–100 integer score blending player ranking parity, star presence,
// tournament tier and round multipliers. Internal-only — drives the
// ops highlight picker; feed-ranking integration deferred.
// See docs/superpowers/specs/2026-05-12-match-quality-score-design.md.

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/** Elo-style expected win for pair A vs pair B (using effective pair ranks). */
export const pWin = (pA: number, pB: number): number =>
  1 / (1 + 10 ** ((pA - pB) / 400))

/** Parity: 1.0 = perfectly even, 0.0 = certain blowout. */
export const parity = (pWinA: number): number => 1 - 2 * Math.abs(pWinA - 0.5)

/** When ranking is missing, treat the player as rank 1500 (deep tail). */
export const UNRANKED_FALLBACK = 1500

/**
 * Effective pair rank: weighted blend of the best and worst rankings.
 * Best gets 0.65 weight (one strong partner anchors the pair), worst 0.35.
 */
export function pairEffRank(
  rank1: number | null,
  rank2: number | null,
): number {
  const r1 = rank1 ?? UNRANKED_FALLBACK
  const r2 = rank2 ?? UNRANKED_FALLBACK
  const best = Math.min(r1, r2)
  const worst = Math.max(r1, r2)
  return best * 0.65 + worst * 0.35
}

/** Linear star-power from average rank: 0.0 at rank 2000+, 1.0 at rank 0. */
export const starPower = (avgRank: number): number =>
  clamp01((2000 - avgRank) / 2000)

/**
 * Star damper: multiplicative penalty applied to parity. Ranges 0.5–1.0.
 * A pair of top-50 players keeps the damper near 1; rank-1000s pull it to 0.75.
 * Designed to dampen never add — pure parity at the tail still produces a
 * floored score, but a balanced tail match cannot beat a balanced top match.
 */
export const starDamper = (avgRank: number): number =>
  0.5 + 0.5 * starPower(avgRank)

export type RoundKey =
  | 'final' | 'sf' | 'qf' | 'r16' | 'r32' | 'r64' | 'r128' | 'q' | 'unknown'

/**
 * Normalize a raw round string into a canonical key. The DB stores
 * inconsistent formats — "Round of 32" from padelapi, "R32" from
 * Crionet, "1/16" from FIP — all of which should collapse to 'r32'.
 *
 * Why this is a substring matcher with explicit early-outs rather
 * than a regex: "Semifinal" contains "final" and "Quarterfinal"
 * contains "quarter" — naïve substring matches misclassify them.
 */
export function roundKey(raw: string | null | undefined): RoundKey {
  if (!raw) return 'unknown'
  const s = raw.toLowerCase().replace(/\s+/g, '')
  // Check most-specific patterns first.
  if (s.includes('semi') || s === '1/2' || s === 'sf') return 'sf'
  if (s.includes('quarter') || s === '1/4' || s === 'qf') return 'qf'
  if (s.includes('final')) return 'final'
  if (s.includes('roundof128') || s.includes('r128')) return 'r128'
  if (s.includes('roundof64') || s.includes('r64') || s === '1/32') return 'r64'
  if (s.includes('roundof32') || s.includes('r32') || s === '1/16') return 'r32'
  if (s.includes('roundof16') || s.includes('r16') || s === '1/8') return 'r16'
  if (s.startsWith('q') || s.includes('quali')) return 'q'
  return 'unknown'
}

const ROUND_WEIGHT_TABLE: Record<RoundKey, number> = {
  final: 1.15,
  sf: 0.90,
  qf: 0.80,
  r16: 0.70,
  r32: 0.62,
  r64: 0.55,
  r128: 0.48,
  q: 0.40,
  unknown: 0.55,
}
export const roundWeight = (raw: string | null | undefined): number =>
  ROUND_WEIGHT_TABLE[roundKey(raw)]

const ALPHA_TABLE: Record<RoundKey, number> = {
  final: 0.00,
  sf: 0.05,
  qf: 0.10,
  r16: 0.15,
  r32: 0.20,
  r64: 0.25,
  r128: 0.30,
  q: 0.35,
  unknown: 0.20,
}
/**
 * α(round) — how much the star bonus weighs at this round.
 * Early rounds need star pull because there's no marquee parity story
 * (every R64 is two unknown mid-50s); Finals don't need it (everyone
 * left is a star, parity decides).
 */
export const alpha = (raw: string | null | undefined): number =>
  ALPHA_TABLE[roundKey(raw)]

const TIER_WEIGHT_TABLE: Record<string, number> = {
  p1: 1.00,
  major: 0.95,
  p2: 0.85,
  premier_mens: 0.85,
  premier_womens: 0.85,
  fip_gold: 0.75,
  fip_silver: 0.70,
  fip_bronze: 0.65,
}
const TIER_UNKNOWN_WEIGHT = 0.70
export function tierWeight(level: string | null | undefined): number {
  if (!level) return TIER_UNKNOWN_WEIGHT
  return TIER_WEIGHT_TABLE[level.toLowerCase()] ?? TIER_UNKNOWN_WEIGHT
}

/**
 * Star strength tier-by-rank. Stepped (not smooth) so it's easy to
 * audit and tune — moving the #15/#16 boundary is one number, not a
 * curve-fit. Beyond #100 there's effectively no draw.
 */
export function starStrength(bestRankOnCourt: number | null): number {
  if (bestRankOnCourt == null) return 0
  if (bestRankOnCourt <= 5) return 1.00
  if (bestRankOnCourt <= 15) return 0.75
  if (bestRankOnCourt <= 30) return 0.50
  if (bestRankOnCourt <= 60) return 0.25
  if (bestRankOnCourt <= 100) return 0.10
  return 0
}

const UNRANKED_PENALTY = 0.15

export interface MatchQualityInput {
  pair1Rankings: [number | null, number | null]
  pair2Rankings: [number | null, number | null]
  tournamentLevel: string | null
  round: string | null
}

function hasUnranked(input: MatchQualityInput): boolean {
  return (
    input.pair1Rankings[0] == null ||
    input.pair1Rankings[1] == null ||
    input.pair2Rankings[0] == null ||
    input.pair2Rankings[1] == null
  )
}

function bestRankOnCourt(input: MatchQualityInput): number | null {
  const ranks = [
    input.pair1Rankings[0],
    input.pair1Rankings[1],
    input.pair2Rankings[0],
    input.pair2Rankings[1],
  ].filter((r): r is number => r != null)
  if (ranks.length === 0) return null
  return Math.min(...ranks)
}

export interface MatchQualityBreakdown {
  score: number          // 0–100 integer (same as matchQualityScore)
  parity: number         // 0..1
  starDamper: number     // 0.5..1.0
  starBonus: number      // 0..0.35
  tierW: number          // 0.65..1.00
  roundW: number         // 0.40..1.15
  unrankedPenalty: number // 1 or 0.15
}

/**
 * Compute the full breakdown — single source of truth for the formula.
 * `matchQualityScore` is a thin wrapper that returns only `score`.
 * Keeping both functions consistent is enforced by having only one
 * place that does the arithmetic.
 */
export function matchQualityBreakdown(input: MatchQualityInput): MatchQualityBreakdown {
  const pA = pairEffRank(input.pair1Rankings[0], input.pair1Rankings[1])
  const pB = pairEffRank(input.pair2Rankings[0], input.pair2Rankings[1])
  const par = parity(pWin(pA, pB))
  const damper = starDamper((pA + pB) / 2)
  const bonus = alpha(input.round) * starStrength(bestRankOnCourt(input))
  const tw = tierWeight(input.tournamentLevel)
  const rw = roundWeight(input.round)
  const unr = hasUnranked(input) ? UNRANKED_PENALTY : 1
  return {
    score: Math.round(clamp01((par * damper + bonus) * tw * rw * unr) * 100),
    parity: par,
    starDamper: damper,
    starBonus: bonus,
    tierW: tw,
    roundW: rw,
    unrankedPenalty: unr,
  }
}

/** Integer score in [0, 100]. Thin wrapper over `matchQualityBreakdown`. */
export function matchQualityScore(input: MatchQualityInput): number {
  return matchQualityBreakdown(input).score
}
