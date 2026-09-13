// src/lib/__tests__/player-equipment.test.ts
import { describe, it, expect } from 'vitest'
import { planRacketChange } from '../player-equipment'

const TODAY = '2026-09-12'

describe('planRacketChange', () => {
  it('opens an assignment when there is none', () => {
    expect(planRacketChange({ activeRacketId: null, nextRacketId: 'r1', today: TODAY }))
      .toEqual({ endActive: false, insert: { racketId: 'r1', startedAt: TODAY } })
  })

  it('closes the active one and opens the new one on the same day', () => {
    expect(planRacketChange({ activeRacketId: 'r1', nextRacketId: 'r2', today: TODAY }))
      .toEqual({ endActive: true, insert: { racketId: 'r2', startedAt: TODAY } })
  })

  it('closes without opening when clearing', () => {
    expect(planRacketChange({ activeRacketId: 'r1', nextRacketId: null, today: TODAY }))
      .toEqual({ endActive: true, insert: null })
  })

  it('does nothing when the racket did not change', () => {
    expect(planRacketChange({ activeRacketId: 'r1', nextRacketId: 'r1', today: TODAY }))
      .toEqual({ endActive: false, insert: null })
  })

  it('does nothing when clearing an already-empty assignment', () => {
    expect(planRacketChange({ activeRacketId: null, nextRacketId: null, today: TODAY }))
      .toEqual({ endActive: false, insert: null })
  })
})
