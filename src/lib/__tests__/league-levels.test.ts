import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEAGUE_LEVELS, isLeagueLevel } from '../league-levels'

describe('isLeagueLevel', () => {
  it('matches the two PPL levels', () => {
    expect(isLeagueLevel('ppl')).toBe(true)
    expect(isLeagueLevel('ppl_ii')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isLeagueLevel('PPL')).toBe(true)
    expect(isLeagueLevel('Ppl_II')).toBe(true)
  })

  it('rejects every circuit level', () => {
    for (const level of ['major', 'finals', 'p1', 'p2', 'fip_platinum', 'fip_gold', 'fip_silver', 'fip_bronze', 'fip_other']) {
      expect(isLeagueLevel(level)).toBe(false)
    }
  })

  it('treats null, undefined and empty string as not-league', () => {
    expect(isLeagueLevel(null)).toBe(false)
    expect(isLeagueLevel(undefined)).toBe(false)
    expect(isLeagueLevel('')).toBe(false)
  })

  it('exposes the level set', () => {
    expect([...LEAGUE_LEVELS].sort()).toEqual(['ppl', 'ppl_ii'])
  })
})

describe('padelgod mirror', () => {
  it('is byte-identical to the Next.js copy', () => {
    const root = join(__dirname, '..', '..', '..')
    const a = readFileSync(join(root, 'src/lib/league-levels.ts'), 'utf8')
    const b = readFileSync(join(root, 'padelgod/src/lib/league-levels.ts'), 'utf8')
    expect(b).toBe(a)
  })
})
