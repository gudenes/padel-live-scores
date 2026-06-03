import { describe, it, expect } from 'vitest'
import { summarizeRefresh, buildRefreshLabel } from '../refresh-tournament-client'

describe('summarizeRefresh', () => {
  it('sums inserted/written/resolved and splits out matches', () => {
    const steps = [
      { name: 'draw-fetcher', summary: { totalMatchesInserted: 12 } },
      { name: 'entry-list-fetcher', summary: { totalSnapshotsInserted: 3, totalPlayersResolved: 40 } },
      { name: 'fip-draw-populator', summary: { inserted: 5, skippedBye: 9 } },
    ]
    const { total, matches } = summarizeRefresh(steps)
    expect(matches).toBe(17)
    expect(total).toBe(60)
  })
  it('handles missing/empty', () => {
    expect(summarizeRefresh(undefined)).toEqual({ total: 0, matches: 0 })
  })
})

describe('buildRefreshLabel', () => {
  it('matches added → +N matches, outcome added', () => {
    expect(buildRefreshLabel(17, 12)).toEqual({ label: '✓ +12 matches', added: true, outcome: 'added' })
  })
  it('singular match', () => {
    expect(buildRefreshLabel(1, 1)).toEqual({ label: '✓ +1 match', added: true, outcome: 'added' })
  })
  it('non-match writes → N updated, outcome added', () => {
    expect(buildRefreshLabel(7, 0)).toEqual({ label: '✓ 7 updated', added: true, outcome: 'added' })
  })
  it('nothing → no new data, outcome no-data', () => {
    expect(buildRefreshLabel(0, 0)).toEqual({ label: '✓ no new data', added: false, outcome: 'no-data' })
  })
})
