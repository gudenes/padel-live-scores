import { describe, it, expect } from 'vitest'
import { shouldInjectAdAfter, AD_FEED_CADENCE } from '@/lib/ad-injection'

describe('shouldInjectAdAfter', () => {
  it('defaults to a cadence of 6', () => {
    expect(AD_FEED_CADENCE).toBe(6)
  })

  it('injects after every 6th match (1-based position)', () => {
    expect(shouldInjectAdAfter(6)).toBe(true)
    expect(shouldInjectAdAfter(12)).toBe(true)
    expect(shouldInjectAdAfter(18)).toBe(true)
  })

  it('does not inject between the cadence boundaries', () => {
    expect(shouldInjectAdAfter(1)).toBe(false)
    expect(shouldInjectAdAfter(5)).toBe(false)
    expect(shouldInjectAdAfter(7)).toBe(false)
  })

  it('never injects at or below position 0', () => {
    expect(shouldInjectAdAfter(0)).toBe(false)
    expect(shouldInjectAdAfter(-6)).toBe(false)
  })

  it('honors a custom cadence', () => {
    expect(shouldInjectAdAfter(4, 4)).toBe(true)
    expect(shouldInjectAdAfter(6, 4)).toBe(false)
  })

  it('never injects when cadence is non-positive', () => {
    expect(shouldInjectAdAfter(6, 0)).toBe(false)
  })
})
