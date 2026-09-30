import { describe, it, expect } from 'vitest'
import { tierFromLevel } from '../types'

describe('tierFromLevel default-deny', () => {
  it('returns null for team-league levels', () => {
    expect(tierFromLevel('ppl', 'men')).toBeNull()
    expect(tierFromLevel('ppl', 'women')).toBeNull()
    expect(tierFromLevel('ppl_ii', 'men')).toBeNull()
    expect(tierFromLevel('ppl_ii', 'women')).toBeNull()
  })

  it('returns null for unknown and null levels', () => {
    expect(tierFromLevel('some_new_tier', 'men')).toBeNull()
    expect(tierFromLevel(null, 'men')).toBeNull()
  })

  it('still maps every earning circuit tier', () => {
    expect(tierFromLevel('p1', 'men')).toBe('p1')
    expect(tierFromLevel('p2', 'men')).toBe('p2')
    expect(tierFromLevel('major', 'men')).toBe('major_i')
    expect(tierFromLevel('finals', 'men')).toBe('major_i')
    expect(tierFromLevel('fip_bronze', 'men')).toBe('fip_bronze')
    expect(tierFromLevel('fip_silver', 'men')).toBe('fip_silver')
    expect(tierFromLevel('fip_gold', 'men')).toBe('fip_gold')
    expect(tierFromLevel('fip_platinum', 'men')).toBe('fip_platinum')
  })
})
