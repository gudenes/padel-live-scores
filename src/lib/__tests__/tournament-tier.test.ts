import { describe, it, expect } from 'vitest'
import { isPremierTier } from '../tournament-tier'

describe('isPremierTier', () => {
  it('returns true for P1/P2/Major/Premier_* levels', () => {
    expect(isPremierTier('P1')).toBe(true)
    expect(isPremierTier('P2')).toBe(true)
    expect(isPremierTier('Major')).toBe(true)
    expect(isPremierTier('Premier_Mens')).toBe(true)
    expect(isPremierTier('Premier_Womens')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isPremierTier('p1')).toBe(true)
    expect(isPremierTier('major')).toBe(true)
    expect(isPremierTier('PREMIER_MENS')).toBe(true)
  })

  it('returns false for FIP-tier levels', () => {
    expect(isPremierTier('fip_bronze')).toBe(false)
    expect(isPremierTier('fip_silver')).toBe(false)
    expect(isPremierTier('fip_gold')).toBe(false)
    expect(isPremierTier('FIP_Bronze')).toBe(false)
  })

  it('returns false for null/undefined/empty', () => {
    expect(isPremierTier(null)).toBe(false)
    expect(isPremierTier(undefined)).toBe(false)
    expect(isPremierTier('')).toBe(false)
  })

  it('returns false for unknown levels', () => {
    expect(isPremierTier('apt')).toBe(false)
    expect(isPremierTier('local_league')).toBe(false)
  })
})
