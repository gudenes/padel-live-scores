// apps/ops/src/lib/__tests__/player-duplicate-rules.test.ts
import { describe, it, expect } from 'vitest'
import { findRuleBasedDuplicates, countDuplicateGroups, normalize, nameTokens, type PlayerRow } from '@/lib/player-duplicate-rules'

const make = (id: string, name: string, country?: string | null, fip_id?: string | null, external_id?: string | null): PlayerRow => ({
  id, name, country: country ?? null, ranking: null, points: null, category: null, avatar_url: null, fip_id: fip_id ?? null, external_id: external_id ?? null,
})

describe('player-duplicate-rules', () => {
  describe('normalize', () => {
    it('strips diacritics, lowercases, collapses whitespace', () => {
      expect(normalize('  Áéíóú  ')).toBe('aeiou')
    })
    it('strips non-alphanumeric and collapses internal whitespace', () => {
      expect(normalize('María-José  Bonita!')).toBe('mariajose bonita')
    })
  })

  describe('nameTokens', () => {
    it('returns first + surname for multi-token names', () => {
      expect(nameTokens('Paula Josemaría González')).toEqual({ first: 'paula', surname: 'gonzalez' })
    })
    it('handles single-token names', () => {
      expect(nameTokens('Bea')).toEqual({ first: 'bea', surname: '' })
    })
    it('handles empty input', () => {
      expect(nameTokens('')).toEqual({ first: '', surname: '' })
    })
  })

  describe('findRuleBasedDuplicates', () => {
    it('returns empty array when no duplicates', () => {
      expect(findRuleBasedDuplicates([make('1', 'Paula Josemaría'), make('2', 'Ariana Sánchez')])).toEqual([])
    })

    it('groups by shared fip_id', () => {
      const players = [
        make('1', 'Paula Josemaría', 'ES', 'P200001'),
        make('2', 'Paula Josemaria', 'ES', 'P200001'),
      ]
      const groups = findRuleBasedDuplicates(players)
      expect(groups.length).toBeGreaterThanOrEqual(1)
      const fipGroup = groups.find(g => g.reasons.some(r => r.toLowerCase().includes('fip')))
      expect(fipGroup).toBeDefined()
      expect(fipGroup!.players.map(p => p.id).sort()).toEqual(['1', '2'])
    })

    it('groups by normalized name + country', () => {
      const players = [
        make('1', 'Juan Lebrón', 'ES'),
        make('2', 'Juan Lebron', 'ES'),
      ]
      const groups = findRuleBasedDuplicates(players)
      expect(groups.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('countDuplicateGroups', () => {
    it('returns the number of groups returned by findRuleBasedDuplicates', () => {
      const players = [
        make('1', 'Paula', 'ES', 'P1'),
        make('2', 'Paula', 'ES', 'P1'),
        make('3', 'Ariana', 'ES', 'P2'),
        make('4', 'Ariana', 'ES', 'P2'),
      ]
      const groups = findRuleBasedDuplicates(players)
      expect(countDuplicateGroups(players)).toBe(groups.length)
      expect(countDuplicateGroups(players)).toBeGreaterThanOrEqual(2)
    })

    it('returns 0 for empty and singleton inputs', () => {
      expect(countDuplicateGroups([])).toBe(0)
      expect(countDuplicateGroups([make('1', 'Paula', 'ES', 'P1')])).toBe(0)
    })
  })
})
