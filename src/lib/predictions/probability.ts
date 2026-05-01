// src/lib/predictions/probability.ts
//
// Pure model that turns a Match into per-pair win probabilities, plus
// the inverse-probability multiplier used by the Guacas economy.
//
// v1: ranking-based logistic, conservatively clamped to [0.20, 0.80].
// Anything missing a ranking falls back to 50/50 (toss-up UI).

import type { Match, Player } from '@/types/match'
import {
  MULTIPLIER_CAP,
  MULTIPLIER_FLOOR,
  MARGIN_BONUS,
  PROB_CLAMP_MIN,
  PROB_CLAMP_MAX,
} from './constants'
import type { ProbabilityResult } from './types'

function pairRankings(p1: Player | null | undefined, p2: Player | null | undefined): number[] {
  return [p1?.ranking, p2?.ranking].filter(
    (r): r is number => typeof r === 'number' && r > 0,
  )
}

function avgRanking(ranks: number[]): number | null {
  if (ranks.length === 0) return null
  return ranks.reduce((a, b) => a + b, 0) / ranks.length
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}

export function computeMatchProbability(match: Match): ProbabilityResult {
  const p1Ranks = pairRankings(match.pair1_player1, match.pair1_player2)
  const p2Ranks = pairRankings(match.pair2_player1, match.pair2_player2)

  // Need all 4 players ranked (2 per pair) to produce a meaningful estimate.
  const allRanked = p1Ranks.length === 2 && p2Ranks.length === 2

  if (!allRanked) {
    return { p1: 0.5, p2: 0.5, isFallback: true }
  }

  const avg1 = avgRanking(p1Ranks)!
  const avg2 = avgRanking(p2Ranks)!

  // Strength: lower ranking = stronger. Use log so the gap between #1 and
  // #10 is much bigger than between #200 and #210 (ranking is ordinal,
  // not interval).
  const strength1 = Math.log(1 / avg1)
  const strength2 = Math.log(1 / avg2)
  const diff = strength1 - strength2

  // Scale factor on the log-strength diff. Top-of-rankings gaps saturate
  // the [0.20, 0.80] clamp (e.g. #1-2 vs #10-11 → 0.95 raw → 0.80 clamped),
  // which is intended — a #1 vs #11 IS a heavy favorite. SCALE primarily
  // affects mid-table matchups: at SCALE=1.5, #100 vs #120 → ~0.57,
  // #50 vs #60 → ~0.57. Lower SCALE = flatter mid-table; higher = sharper.
  const SCALE = 1.5

  const p1Raw = sigmoid(diff * SCALE)
  const p1Clamped = clamp(p1Raw, PROB_CLAMP_MIN, PROB_CLAMP_MAX)

  // Clamp p2 symmetrically to avoid floating-point drift (e.g. 1 - 0.80 = 0.19999...96).
  const p2Clamped = clamp(1 - p1Clamped, PROB_CLAMP_MIN, PROB_CLAMP_MAX)

  return {
    p1: p1Clamped,
    p2: p2Clamped,
    isFallback: false,
  }
}

/** Inverse-probability multiplier with optional margin bonus. */
export function computeMultiplier(probability: number, marginCorrect: boolean): number {
  const safeP = clamp(probability, 0.0001, 1)
  const base = clamp(
    Math.round((1 / safeP) * 100) / 100,
    MULTIPLIER_FLOOR,
    MULTIPLIER_CAP,
  )
  return marginCorrect ? base + MARGIN_BONUS : base
}
