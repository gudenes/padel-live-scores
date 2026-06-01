import { describe, it, expect } from 'vitest'
import {
  shouldAutoAsk,
  MIN_OPENS,
  APP_OPENS_THRESHOLD,
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
    const tenDaysAgo = new Date('2026-05-22T12:00:00Z').toISOString()
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD, lastAskedAt: tenDaysAgo }
    expect(shouldAutoAsk(state, NOW, 'favorite', true)).toBe(false)
  })

  it('asks again after the cooldown window elapses', () => {
    const seventyDaysAgo = new Date('2026-03-23T12:00:00Z').toISOString()
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD, lastAskedAt: seventyDaysAgo }
    expect(shouldAutoAsk(state, NOW, 'favorite', true)).toBe(true)
  })
})
