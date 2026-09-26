import { describe, it, expect } from 'vitest'
import { PLAYER_TIERS, isProTier, isAmateurTier, type PlayerTier } from '../player-tier'

describe('player-tier', () => {
  it('exposes exactly the two known tiers', () => {
    expect(PLAYER_TIERS).toEqual(['pro', 'amateur'])
  })

  it('treats a null or missing tier as pro', () => {
    expect(isProTier(null)).toBe(true)
    expect(isProTier(undefined)).toBe(true)
  })

  it('classifies known tiers', () => {
    expect(isProTier('pro')).toBe(true)
    expect(isProTier('amateur')).toBe(false)
    expect(isAmateurTier('amateur')).toBe(true)
    expect(isAmateurTier(null)).toBe(false)
  })

  it('treats an unknown tier string as non-amateur', () => {
    const unknown = 'legend' as PlayerTier
    expect(isAmateurTier(unknown)).toBe(false)
    expect(isProTier(unknown)).toBe(false)
  })
})
