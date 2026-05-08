// src/lib/predictions/server.ts
//
// Server-side helpers for prediction creation.
// Keep all client-untrusted logic (lock-window, prob/mult computation) here so
// the API routes stay thin and testable.

import { computeMatchProbability, computeMultiplier } from './probability'
import type { Match } from '@/types/match'
import type { Pair, Margin } from './types'

export function isPickWindowOpen(match: Match, now: Date): boolean {
  // Status gate: only 'scheduled' matches accept new picks.
  if (match.status !== 'scheduled') return false
  // Time gate: if scheduled_at is set and in the past, the window is closed.
  // scheduled_at being null means "TBD"; we still allow picks in that case.
  if (match.scheduled_at) {
    const startsAt = new Date(match.scheduled_at).getTime()
    if (Number.isFinite(startsAt) && startsAt <= now.getTime()) return false
  }
  return true
}

export interface BuildPredictionInput {
  userId: string
  pair: Pair
  margin: Margin
}

export interface PredictionRowDraft {
  user_id: string
  match_id: string
  pair: Pair
  margin: Margin
  probability: number
  multiplier: number
  is_fallback: boolean
}

export function buildPredictionRow(
  match: Match,
  input: BuildPredictionInput,
): PredictionRowDraft {
  const prob = computeMatchProbability(match)
  const userPairProb = input.pair === 1 ? prob.p1 : prob.p2
  // marginCorrect=false here freezes the BASE multiplier. The margin bonus
  // is applied later by computeReward() at finish-time.
  const multiplier = computeMultiplier(userPairProb, false)
  return {
    user_id: input.userId,
    match_id: match.id,
    pair: input.pair,
    margin: input.margin,
    probability: userPairProb,
    multiplier,
    is_fallback: prob.isFallback,
  }
}
