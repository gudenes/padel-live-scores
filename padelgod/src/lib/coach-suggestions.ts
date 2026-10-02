// padelgod/src/lib/coach-suggestions.ts
//
// Fuzzy matching for coaches produces SUGGESTIONS ONLY — never an alias or
// a merge. Lesson from d59a7206c (Momo González conflation): fuzzy matches
// that auto-write aliases glue different people together, and coaches have
// no category/country/ranking to tell them apart.

import { subsetSimilarity, typoTolerantSimilarity } from './db-resolver.js'
import { coachTokens } from './coach-normalize.js'

export interface SuggestionCoach {
  id: string
  normalized_name: string
  status: 'unreviewed' | 'verified' | 'junk' | 'merged'
  player_id: string | null
  /** Extra normalized spellings (coach_aliases) the coach has absorbed. */
  names?: string[]
}

export interface MergeSuggestion {
  coach_a: string
  coach_b: string
  score: number
  reason: 'subset' | 'typo'
}

export interface PlayerLinkSuggestion {
  coach_id: string
  player_id: string
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

const TYPO_THRESHOLD = 0.99

function eligible(c: SuggestionCoach): boolean {
  return c.status !== 'junk' && c.status !== 'merged' && coachTokens(c.normalized_name).length >= 2
}

/** Unique spellings (normalized_name + absorbed names) with >=2 tokens. */
function spellings(c: SuggestionCoach): string[] {
  return [...new Set([c.normalized_name, ...(c.names ?? [])])].filter((n) => coachTokens(n).length >= 2)
}

/**
 * Compares every spelling each coach has (normalized_name + absorbed aliases),
 * so a merge that deletes a source's suggestions doesn't hide its spellings.
 * @param existingPairs pairKey() of every coach_merge_suggestions row, any status
 */
export function generateMergeSuggestions(
  coaches: SuggestionCoach[],
  existingPairs: Set<string>,
): MergeSuggestion[] {
  const pool = coaches
    .filter((c) => c.status !== 'junk' && c.status !== 'merged')
    .map((c) => ({ id: c.id, names: spellings(c) }))
    .filter((c) => c.names.length > 0)
  const out: MergeSuggestion[] = []
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const x = pool[i]
      const y = pool[j]
      if (!x || !y) continue
      const key = pairKey(x.id, y.id)
      if (existingPairs.has(key)) continue
      const [coach_a = '', coach_b = ''] = key.split('|')
      let subset = false
      let best = 0
      for (const nx of x.names) {
        for (const ny of y.names) {
          if (subsetSimilarity(nx, ny) === 1) subset = true
          else if (!subset) best = Math.max(best, typoTolerantSimilarity(nx, ny))
        }
      }
      if (subset) out.push({ coach_a, coach_b, score: 1, reason: 'subset' })
      else if (best >= TYPO_THRESHOLD) out.push({ coach_a, coach_b, score: Number(best.toFixed(3)), reason: 'typo' })
    }
  }
  return out
}

/**
 * Exact normalized-name match between an unlinked coach and a player.
 * @param players normalized_name MUST be computed with normalizeCoachName(name), NOT the DB
 *   column players.normalized_name (trigger-built; it handles apostrophes differently).
 * @param existingPairs `${coach_id}|${player_id}` of every coach_player_link_suggestions row, any status
 * @param linkedPlayerIds players already set as some coach's player_id
 */
export function generatePlayerLinkSuggestions(
  coaches: SuggestionCoach[],
  players: { id: string; normalized_name: string }[],
  existingPairs: Set<string>,
  linkedPlayerIds: Set<string>,
): PlayerLinkSuggestion[] {
  const byName = new Map<string, string[]>()
  for (const p of players) {
    if (!p.normalized_name) continue
    const ids = byName.get(p.normalized_name)
    if (ids) ids.push(p.id)
    else byName.set(p.normalized_name, [p.id])
  }
  const out: PlayerLinkSuggestion[] = []
  for (const c of coaches) {
    if (!eligible(c) || c.player_id) continue
    for (const playerId of byName.get(c.normalized_name) ?? []) {
      if (linkedPlayerIds.has(playerId)) continue
      if (existingPairs.has(`${c.id}|${playerId}`)) continue
      out.push({ coach_id: c.id, player_id: playerId })
    }
  }
  return out
}
