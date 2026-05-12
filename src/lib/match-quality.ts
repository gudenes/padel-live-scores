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
