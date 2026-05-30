// src/lib/odds/prematch.ts
// Pre-match win probability from FIP rankings.
// MIRROR of the formula/constants in src/lib/predictions/probability.ts (kept in
// sync deliberately). Self-contained so it can be byte-mirrored into padelgod.

const SCALE = 1.5
const PROB_CLAMP_MIN = 0.2
const PROB_CLAMP_MAX = 0.8

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}
function avg(ranks: number[]): number {
  return ranks.reduce((a, b) => a + b, 0) / ranks.length
}

/** rankings = [pair1p1, pair1p2, pair2p1, pair2p2]; lower = stronger. */
export function preMatchProb(
  rankings: [number | null, number | null, number | null, number | null],
): { p1: number; p2: number; fallback: boolean } {
  const [a, b, c, d] = rankings
  const p1Ranks = [a, b].filter((r): r is number => typeof r === 'number' && r > 0)
  const p2Ranks = [c, d].filter((r): r is number => typeof r === 'number' && r > 0)
  if (p1Ranks.length !== 2 || p2Ranks.length !== 2) {
    return { p1: 0.5, p2: 0.5, fallback: true }
  }
  const s1 = Math.log(1 / avg(p1Ranks))
  const s2 = Math.log(1 / avg(p2Ranks))
  const p1 = clamp(sigmoid((s1 - s2) * SCALE), PROB_CLAMP_MIN, PROB_CLAMP_MAX)
  const p2 = clamp(1 - p1, PROB_CLAMP_MIN, PROB_CLAMP_MAX)
  return { p1, p2, fallback: false }
}

/** Inverse-probability fair odds, rounded to 2dp. */
export function fairOdds(prob: number): number {
  const safe = clamp(prob, 0.0001, 1)
  return Math.round((1 / safe) * 100) / 100
}
