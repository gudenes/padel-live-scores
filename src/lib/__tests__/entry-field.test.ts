import { describe, it, expect } from 'vitest'
import { partitionField, combinedPoints, bestRank, type FieldEntry } from '@/lib/entry-field'

function entry(over: Partial<FieldEntry> = {}): FieldEntry {
  return {
    id: 'e1',
    seed: null,
    marker: null,
    category: 'men',
    player1_id: 'p1',
    player1_name: 'One',
    player1_country: 'ES',
    player2_id: 'p2',
    player2_name: 'Two',
    player2_country: 'AR',
    team_points: null,
    ...over,
  }
}

describe('partitionField', () => {
  it('puts seeded pairs first, ordered by seed ascending', () => {
    const { seeded } = partitionField([
      entry({ seed: 3, player1_id: 'c' }),
      entry({ seed: 1, player1_id: 'a' }),
      entry({ seed: 2, player1_id: 'b' }),
    ])
    expect(seeded.map((e) => e.seed)).toEqual([1, 2, 3])
  })

  it('orders unseeded pairs by team points descending', () => {
    const { unseeded } = partitionField([
      entry({ team_points: 1200 }),
      entry({ team_points: 3400 }),
      entry({ team_points: 2200 }),
    ])
    expect(unseeded.map((e) => e.team_points)).toEqual([3400, 2200, 1200])
  })

  it('sinks unseeded pairs with no points to the bottom', () => {
    const { unseeded } = partitionField([
      entry({ team_points: null }),
      entry({ team_points: 900 }),
    ])
    expect(unseeded.map((e) => e.team_points)).toEqual([900, null])
  })

  it('splits seeded from unseeded', () => {
    const { seeded, unseeded } = partitionField([
      entry({ seed: 1 }),
      entry({ seed: null }),
      entry({ seed: 2 }),
    ])
    expect(seeded).toHaveLength(2)
    expect(unseeded).toHaveLength(1)
  })

  it('handles an empty field', () => {
    expect(partitionField([])).toEqual({ seeded: [], unseeded: [] })
  })
})

describe('combinedPoints', () => {
  it('returns the team points when present', () => {
    expect(combinedPoints(entry({ team_points: 4653 }))).toBe(4653)
  })

  it('returns null when there are no points', () => {
    expect(combinedPoints(entry({ team_points: null }))).toBe(null)
  })
})

describe('bestRank', () => {
  it('returns the lower (better) of the two rankings', () => {
    const map = { p1: { avatar_url: null, ranking: 26 }, p2: { avatar_url: null, ranking: 12 } }
    expect(bestRank(entry(), map)).toBe(12)
  })

  it('ignores a player with no ranking', () => {
    const map = { p1: { avatar_url: null, ranking: 26 }, p2: { avatar_url: null, ranking: null } }
    expect(bestRank(entry(), map)).toBe(26)
  })

  it('returns null when neither player is ranked', () => {
    expect(bestRank(entry(), {})).toBe(null)
  })
})
