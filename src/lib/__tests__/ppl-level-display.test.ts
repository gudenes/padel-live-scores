import { describe, it, expect } from 'vitest'
import { levelLabel, levelTierWeight, isPremierLevel } from '../tournament-labels'
import { getTierPill, getTierGradient, FALLBACK_PILL, FALLBACK_GRADIENT } from '../tournament-tier-style'

describe('PPL level display', () => {
  it('labels both levels', () => {
    expect(levelLabel('ppl')).toBe('PPL')
    expect(levelLabel('ppl_ii')).toBe('PPL II')
  })

  it('sorts below every FIP tier but above the unknown fallback', () => {
    expect(levelTierWeight('ppl')).toBe(30)
    expect(levelTierWeight('ppl_ii')).toBe(31)
    expect(levelTierWeight('ppl')).toBeGreaterThan(levelTierWeight('fip_other'))
    expect(levelTierWeight('ppl_ii')).toBeLessThan(levelTierWeight('something-unknown'))
  })

  it('has its own pill and gradient rather than the fallback', () => {
    expect(getTierPill('ppl')).not.toEqual(FALLBACK_PILL)
    expect(getTierPill('ppl_ii')).not.toEqual(FALLBACK_PILL)
    expect(getTierGradient('ppl')).not.toBe(FALLBACK_GRADIENT)
    expect(getTierGradient('ppl_ii')).not.toBe(FALLBACK_GRADIENT)
  })

  it('is not a Premier level (no PBP / Score Recap / Live Feed)', () => {
    expect(isPremierLevel('ppl')).toBe(false)
    expect(isPremierLevel('ppl_ii')).toBe(false)
  })
})
