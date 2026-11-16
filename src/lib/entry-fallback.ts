import type { Match } from '@/types/match'
import type { FieldEntry } from './entry-field'
import { isQualifyingRound, pairKeyFromIds } from './projection-picker'

/** The published field is independent of whether a pair can be projected. */
export function entriesFromDraw(matches: Match[], category: 'men' | 'women'): FieldEntry[] {
  const pairs = new Map<string, FieldEntry>()
  for (const match of matches) {
    if (isQualifyingRound(match.round)) continue
    for (const side of [1, 2] as const) {
      const a = match[`pair${side}_player1`], b = match[`pair${side}_player2`]
      if (!a?.name || !b?.name) continue // Empty feeder/bye slots are not entrants.
      const key = [a.name.trim().toLowerCase(), b.name.trim().toLowerCase()].sort().join('::')
      const previous = pairs.get(key)
      if (previous?.player1_id && previous.player2_id && !(a.id && b.id)) continue
      pairs.set(key, {
        id: `draw:${key}`, category, seed: match[`pair${side}_seed`] ?? previous?.seed ?? null,
        marker: null, player1_id: a.id || null, player2_id: b.id || null,
        player1_name: a.name, player2_name: b.name,
        player1_country: a.country, player2_country: b.country, team_points: null,
      })
    }
  }
  return [...pairs.values()]
}

export function entriesWithoutProjection(entries: FieldEntry[], projectedKeys: Set<string>): FieldEntry[] {
  return entries.filter(e => !e.player1_id || !e.player2_id ||
    !projectedKeys.has(pairKeyFromIds(e.player1_id, e.player2_id)))
}
