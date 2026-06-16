import { describe, it, expect } from 'vitest'
import { BETTING_MARKETS, getBettingMarket, isBettingMarket } from '@/lib/betting-markets'

describe('betting-markets', () => {
  it('returns the market config for an enabled country', () => {
    const m = getBettingMarket('ES')
    expect(m).not.toBeNull()
    expect(m?.minAge).toBe(18)
    expect(m?.disclaimerKey).toBe('es')
  })

  it('is case-insensitive on the country code', () => {
    expect(getBettingMarket('es')).not.toBeNull()
  })

  it('returns null for a staged (disabled) country', () => {
    expect(BETTING_MARKETS.MX.enabled).toBe(false)
    expect(getBettingMarket('MX')).toBeNull()
  })

  it('returns null for an unknown country', () => {
    expect(getBettingMarket('ZZ')).toBeNull()
    expect(getBettingMarket(null)).toBeNull()
    expect(getBettingMarket(undefined)).toBeNull()
  })

  it('isBettingMarket reflects getBettingMarket', () => {
    expect(isBettingMarket('ES')).toBe(true)
    expect(isBettingMarket('MX')).toBe(false)
    expect(isBettingMarket(null)).toBe(false)
  })
})
