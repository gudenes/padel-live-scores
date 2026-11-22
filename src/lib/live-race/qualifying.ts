import { matchRoundPoints, qualifyingSchedule } from './engine'

export interface MatchPoints { winner: number; loser: number; qualifying?: boolean; qualificationBonus?: number }
export interface DrawRow { id: string; round: string | null; round_canonical: string | null; category: string | null }

/** Full tournament draw, never the subset of matches on a selected day.
 * 2026 FIP/Premier rulebooks sections 4.2.1 and 7.1.4–7.2.2.
 * A partial or non-standard bracket is not enough evidence to price a round.
 */
export function qualifyingPoints(level: string, season: string, rows: DrawRow[]): Record<string, MatchPoints> {
  if (season !== '2026' || !qualifyingSchedule[level]) return {}
  const result: Record<string, MatchPoints> = {}
  for (const gender of ['men', 'women']) {
    const own = rows.filter(r => r.category === gender)
    const q = own.map(r => ({ ...r, n: Number(/^Q([1-4])$/i.exec(r.round_canonical ?? r.round ?? '')?.[1] ?? 0) })).filter(r => r.n)
    if (!q.length) continue
    const last = Math.max(...q.map(r => r.n))
    const premier = ['major', 'p1', 'p2'].includes(level)
    const allowed = premier
      ? gender === 'men' ? level === 'p1' ? [1, 2] : [2, 3] : level === 'major' ? [2] : [1, 2]
      : level === 'fip_platinum' ? [3] : level === 'fip_gold' ? [3, 4] : [2, 3, 4]
    if (!allowed.includes(last)) continue
    const qualifiers = level === 'p1' && gender === 'men' ? 8 : 4
    if (q.filter(r => r.n === last).length !== qualifiers) continue
    let complete = true
    for (let n = 1; n <= last; n++) {
      const count = q.filter(r => r.n === n).length
      const expected = qualifiers * 2 ** (last - n)
      // The men's 24-pair Major draw has eight first-round byes.
      if (count !== expected && !(level === 'major' && gender === 'men' && last === 3 && n === 1 && count === 8)) complete = false
    }
    if (!complete) continue
    const [bonus, lastLoss, earlierLoss] = qualifyingSchedule[level]
    const exitPoints = (n: number) => {
      if (n === last) return lastLoss
      if (premier && gender === 'women') return 0
      const paidRound = (level === 'fip_gold' || level === 'fip_silver') && last === 4 ? 3 : 2
      return n === paidRound ? earlierLoss : 0
    }
    // Small Silver/Bronze draws have 16 main-draw pairs. Their two-round
    // qualifier format establishes that size in the published rulebook.
    const firstMain = level === 'major' || (level === 'p1' && gender === 'men') ? 'R64'
      : (level === 'fip_silver' || level === 'fip_bronze') && last === 2 ? 'R16' : 'R32'
    const mainFloor = matchRoundPoints(level, firstMain, season)?.loser
    if (mainFloor == null) continue
    for (const r of q) result[r.id] = {
      winner: r.n === last ? mainFloor + bonus : exitPoints(r.n + 1),
      loser: exitPoints(r.n), qualifying: true,
      qualificationBonus: r.n === last ? bonus : 0,
    }
  }
  return result
}
