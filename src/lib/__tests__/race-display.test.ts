import { describe, expect, it } from 'vitest'
import { raceCutoffPoints, raceGap } from '../race-display'

const row = (race_ranking: number | null, race_points: number | null) => ({ race_ranking, race_points })

describe('Race cutoff display', () => {
  it('uses the sixteenth position rather than the last visible player', () => {
    expect(raceCutoffPoints([row(14, 3880), row(15, 3840), row(16, 3800), row(17, 3750)]))
      .toBe(3800)
    expect(raceGap(3750, 3800)).toBe(50)
  })
  it('respects shared competition ranks across the cutoff', () => {
    expect(raceCutoffPoints([row(15, 3800), row(15, 3800), row(17, 3750)]))
      .toBe(3800)
    expect(raceGap(3800, 3800)).toBe(0)
  })
  it('does not fabricate a cutoff or gap when the required data is missing', () => {
    expect(raceCutoffPoints([row(14, 3800), row(17, 3750)])).toBeNull()
    expect(raceCutoffPoints([row(16, null)])).toBeNull()
    expect(raceGap(3750, null)).toBeNull()
    expect(raceGap(null, 3800)).toBeNull()
  })
})
