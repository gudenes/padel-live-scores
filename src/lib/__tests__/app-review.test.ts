import { describe, it, expect } from 'vitest'
import {
  shouldAutoAsk,
  MIN_OPENS,
  APP_OPENS_THRESHOLD,
  COOLDOWN_DAYS,
  MAX_ASKS,
  type ReviewGateState,
} from '@/lib/app-review'

const base: ReviewGateState = { appOpens: 0, askCount: 0, lastAskedAt: null }
const NOW = new Date('2026-06-01T12:00:00Z')

describe('shouldAutoAsk', () => {
  it('never asks on web (non-native)', () => {
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD }
    expect(shouldAutoAsk(state, NOW, 'app_opens', false)).toBe(false)
  })

  it('never asks below the MIN_OPENS floor', () => {
    const state = { ...base, appOpens: MIN_OPENS - 1 }
    expect(shouldAutoAsk(state, NOW, 'favorite', true)).toBe(false)
  })

  it('asks on a favorite once the floor is met', () => {
    const state = { ...base, appOpens: MIN_OPENS }
    expect(shouldAutoAsk(state, NOW, 'favorite', true)).toBe(true)
  })

  it('asks on app_opens exactly at the threshold', () => {
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD }
    expect(shouldAutoAsk(state, NOW, 'app_opens', true)).toBe(true)
  })

  it('does not ask on app_opens below the threshold', () => {
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD - 1 }
    expect(shouldAutoAsk(state, NOW, 'app_opens', true)).toBe(false)
  })

  it('does not ask on app_opens above the threshold', () => {
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD + 1 }
    expect(shouldAutoAsk(state, NOW, 'app_opens', true)).toBe(false)
  })

  it('does not ask once the lifetime cap is reached', () => {
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD, askCount: MAX_ASKS }
    expect(shouldAutoAsk(state, NOW, 'favorite', true)).toBe(false)
  })

  it('does not ask within the cooldown window', () => {
    const withinWindow = new Date(
      NOW.getTime() - (COOLDOWN_DAYS - 1) * 24 * 60 * 60 * 1000,
    ).toISOString()
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD, lastAskedAt: withinWindow }
    expect(shouldAutoAsk(state, NOW, 'favorite', true)).toBe(false)
  })

  it('asks again after the cooldown window elapses', () => {
    const outsideWindow = new Date(
      NOW.getTime() - (COOLDOWN_DAYS + 10) * 24 * 60 * 60 * 1000,
    ).toISOString()
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD, lastAskedAt: outsideWindow }
    expect(shouldAutoAsk(state, NOW, 'favorite', true)).toBe(true)
  })

  it('asks when lastAskedAt is a corrupt string', () => {
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD, lastAskedAt: 'not-a-date' }
    expect(shouldAutoAsk(state, NOW, 'favorite', true)).toBe(true)
  })
})
