// apps/ops/src/app/(app)/live-odds/_lib/__tests__/map-odds.test.ts
import { describe, it, expect } from 'vitest'
import { mapConfidence, mapStatus, movementFromSnapshots } from '../map-odds'

describe('mapConfidence', () => {
  it('maps model confidence to the UI 3-level scale', () => {
    expect(mapConfidence('full')).toBe('full')
    expect(mapConfidence('med')).toBe('med')
    expect(mapConfidence('pre-match')).toBe('med')
    expect(mapConfidence('thin')).toBe('low')
  })
})

describe('mapStatus', () => {
  it('maps match status to the UI status', () => {
    expect(mapStatus('live')).toBe('Live')
    expect(mapStatus('on_court')).toBe('Live')
    expect(mapStatus('break')).toBe('Break')
    expect(mapStatus('scheduled')).toBe('Scheduled')
    expect(mapStatus('finished')).toBe('Scheduled') // non-live treated as static
  })
})

describe('movementFromSnapshots', () => {
  const now = Date.now()
  const snaps = [
    { match_id: 'm1', pair1_win_prob: 0.50, computed_at: new Date(now - 16 * 60000).toISOString() },
    { match_id: 'm1', pair1_win_prob: 0.62, computed_at: new Date(now - 1 * 60000).toISOString() },
  ]
  it('is latest minus nearest-to-15m-ago, in percentage points', () => {
    expect(movementFromSnapshots(snaps, 'm1', now)).toBe(12) // 0.62 - 0.50 → +12
  })
  it('is 0 when there is no ~15m-ago snapshot', () => {
    expect(movementFromSnapshots([snaps[1]], 'm1', now)).toBe(0)
  })
})
