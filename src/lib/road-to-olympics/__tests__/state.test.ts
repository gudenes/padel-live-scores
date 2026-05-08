// src/lib/road-to-olympics/__tests__/state.test.ts
import { describe, it, expect } from 'vitest'
import {
  computeDaysUntil,
  derivePillStatus,
} from '../state'

describe('computeDaysUntil', () => {
  it('returns positive days when target is in the future', () => {
    const target = new Date('2026-06-24T08:00:00Z').toISOString()
    const now = new Date('2026-05-08T08:00:00Z')
    expect(computeDaysUntil(target, now)).toBe(47)
  })

  it('returns 0 on the same day', () => {
    const target = new Date('2026-06-24T20:00:00Z').toISOString()
    const now = new Date('2026-06-24T08:00:00Z')
    expect(computeDaysUntil(target, now)).toBe(0)
  })

  it('clamps to 0 when target is in the past', () => {
    const target = new Date('2026-04-01T00:00:00Z').toISOString()
    const now = new Date('2026-05-08T00:00:00Z')
    expect(computeDaysUntil(target, now)).toBe(0)
  })
})

describe('derivePillStatus', () => {
  it('returns "done" for compliance when all three flags are true', () => {
    expect(
      derivePillStatus('compliance', {
        charter: true,
        wada: true,
        manipulation: true,
      }),
    ).toBe('done')
  })

  it('returns "building" for compliance when any flag is false', () => {
    expect(
      derivePillStatus('compliance', {
        charter: true,
        wada: false,
        manipulation: true,
      }),
    ).toBe('building')
  })

  it('returns "done" for continents when count >= 3', () => {
    expect(derivePillStatus('continents', 5)).toBe('done')
    expect(derivePillStatus('continents', 3)).toBe('done')
  })

  it('returns "building" for continents when count < 3', () => {
    expect(derivePillStatus('continents', 2)).toBe('building')
  })

  it('returns "on-track" for federations when count >= 50', () => {
    expect(derivePillStatus('federations', 87)).toBe('on-track')
  })

  it('returns "done" for gender when pct >= 50', () => {
    expect(derivePillStatus('gender', 50)).toBe('done')
  })

  it('returns "on-track" for gender when pct in [35, 50)', () => {
    expect(derivePillStatus('gender', 40)).toBe('on-track')
    expect(derivePillStatus('gender', 35)).toBe('on-track')
  })

  it('returns "building" for gender when pct < 35', () => {
    expect(derivePillStatus('gender', 20)).toBe('building')
  })

  it('returns "building" for elite when count <= 2', () => {
    expect(derivePillStatus('elite', 2)).toBe('building')
  })

  it('returns "on-track" for elite when count in [3, 5]', () => {
    expect(derivePillStatus('elite', 4)).toBe('on-track')
  })

  it('returns "done" for elite when count > 5', () => {
    expect(derivePillStatus('elite', 6)).toBe('done')
  })
})
