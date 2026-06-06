import type { Match } from '@/types/match'
import type { ProjectionRow } from '@/lib/projection-types'

/** Order-independent pair key, mirrors the worker/view convention. */
export function pairKeyFromIds(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`
}

/** pair_key → seed, derived from matches (only top 8/16 are seeded). */
export function buildSeedMap(matches: Match[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const m of matches) {
    if (m.pair1_player1?.id && m.pair1_player2?.id && m.pair1_seed != null) {
      map.set(pairKeyFromIds(m.pair1_player1.id, m.pair1_player2.id), m.pair1_seed)
    }
    if (m.pair2_player1?.id && m.pair2_player2?.id && m.pair2_seed != null) {
      map.set(pairKeyFromIds(m.pair2_player1.id, m.pair2_player2.id), m.pair2_seed)
    }
  }
  return map
}

export interface OrderedPicker {
  feature: ProjectionRow[]
  rest: ProjectionRow[]
  eliminated: ProjectionRow[]
}

/** Active pairs by seed (seeded asc, then unseeded by champion desc); the top 4
 *  active become feature cards. Eliminated pairs (greyed) sink to the bottom. */
export function orderPickerPairs(
  rows: ProjectionRow[],
  seedByPair: Map<string, number>,
): OrderedPicker {
  const bySeedThenChamp = (a: ProjectionRow, b: ProjectionRow) => {
    const sa = seedByPair.get(a.pair_key)
    const sb = seedByPair.get(b.pair_key)
    if (sa != null && sb != null) return sa - sb
    if (sa != null) return -1
    if (sb != null) return 1
    return b.champion_prob - a.champion_prob
  }
  const active = rows.filter((r) => r.status !== 'eliminated').sort(bySeedThenChamp)
  const eliminated = rows.filter((r) => r.status === 'eliminated').sort(bySeedThenChamp)

  const seededActive = active.filter((r) => seedByPair.get(r.pair_key) != null).length
  const featureCount = seededActive >= 2 ? Math.min(4, active.length) : 0
  return { feature: active.slice(0, featureCount), rest: active.slice(featureCount), eliminated }
}
