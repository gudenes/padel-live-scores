import { describe, it, expect } from 'vitest'
import { tierWeight } from '../match-quality'

describe('tierWeight team-league', () => {
  it('scores team-league below every circuit tier', () => {
    expect(tierWeight('ppl')).toBeLessThan(tierWeight('fip_bronze'))
    expect(tierWeight('ppl_ii')).toBeLessThan(tierWeight('fip_bronze'))
  })

  it('scores team-league below the unknown-level fallback', () => {
    expect(tierWeight('ppl')).toBeLessThan(tierWeight('some_new_tier'))
  })

  it('leaves circuit weights untouched', () => {
    expect(tierWeight('p1')).toBe(1.00)
    expect(tierWeight('fip_silver')).toBe(0.70)
    expect(tierWeight(null)).toBe(0.70)
  })
})
