import { describe, it, expect } from 'vitest'
import {
  encodeCursor,
  decodeCursor,
  rankRows,
  type LeaderboardRowInput,
} from '../leaderboard-query'

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a cursor', () => {
    const c = { guacas: 100, accuracyPct: 67, picksCount: 12, earliestPickAt: '2026-01-01T00:00:00Z', userId: 'u1' }
    const round = decodeCursor(encodeCursor(c))
    expect(round).toEqual(c)
  })

  it('decode returns null for invalid input', () => {
    expect(decodeCursor('garbage')).toBeNull()
    expect(decodeCursor('')).toBeNull()
    expect(decodeCursor(null)).toBeNull()
  })
})

describe('rankRows', () => {
  const a: LeaderboardRowInput = { userId: 'a', name: 'A', avatar: null, picksCount: 10, accuracyPct: 80, guacas: 200, earliestPickAt: '2026-01-01' }
  const b: LeaderboardRowInput = { userId: 'b', name: 'B', avatar: null, picksCount: 8, accuracyPct: 75, guacas: 200, earliestPickAt: '2026-01-02' }
  const c: LeaderboardRowInput = { userId: 'c', name: 'C', avatar: null, picksCount: 12, accuracyPct: 60, guacas: 100, earliestPickAt: '2026-01-03' }

  it('sorts by guacas DESC, accuracy DESC, picks DESC, earliestPickAt ASC, userId ASC', () => {
    const ranked = rankRows([c, b, a])
    expect(ranked.map(r => r.userId)).toEqual(['a', 'b', 'c'])
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 3])
  })

  it('breaks tie on guacas with accuracy', () => {
    const ranked = rankRows([b, a]) // both 200 guacas, A has higher accuracy
    expect(ranked.map(r => r.userId)).toEqual(['a', 'b'])
  })

  it('breaks tie on guacas+accuracy with picksCount', () => {
    const x: LeaderboardRowInput = { ...a, userId: 'x', picksCount: 5 }
    const y: LeaderboardRowInput = { ...a, userId: 'y', picksCount: 9 }
    const ranked = rankRows([x, y])
    expect(ranked[0].userId).toBe('y')
  })

  it('breaks all-equal tie on earliestPickAt ASC', () => {
    const x: LeaderboardRowInput = { ...a, userId: 'x', earliestPickAt: '2026-02-01' }
    const y: LeaderboardRowInput = { ...a, userId: 'y', earliestPickAt: '2026-01-15' }
    const ranked = rankRows([x, y])
    expect(ranked[0].userId).toBe('y')
  })
})
