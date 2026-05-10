import { describe, expect, it } from 'vitest'
import {
  levelLabel,
  mostAdvancedRound,
  mostAdvancedRoundEntry,
  roundRank,
  stageChipKey,
  ROUND_ORDER,
  ROUND_LABELS,
} from '../tournament-labels'

describe('levelLabel', () => {
  it('maps known levels to display labels', () => {
    expect(levelLabel('p1')).toBe('P1')
    expect(levelLabel('p2')).toBe('P2')
    expect(levelLabel('major')).toBe('Major')
    expect(levelLabel('finals')).toBe('Finals')
    expect(levelLabel('fip_platinum')).toBe('FIP Platinum')
    expect(levelLabel('fip_gold')).toBe('FIP Gold')
    expect(levelLabel('fip_other')).toBe('FIP Tour')
  })

  it('returns the raw string for unknown levels', () => {
    expect(levelLabel('unknown_thing')).toBe('unknown_thing')
  })

  it('returns empty string for null', () => {
    expect(levelLabel(null)).toBe('')
  })
})

describe('ROUND_ORDER and ROUND_LABELS', () => {
  it('contains the expected round codes in order', () => {
    expect(ROUND_ORDER[0]).toBe('F')
    expect(ROUND_ORDER).toContain('SF')
    expect(ROUND_ORDER).toContain('QF')
    expect(ROUND_ORDER).toContain('R16')
  })

  it('every ROUND_ORDER entry has a ROUND_LABELS mapping', () => {
    for (const code of ROUND_ORDER) {
      expect(ROUND_LABELS[code]).toBeTruthy()
    }
  })
})

describe('mostAdvancedRound', () => {
  it('picks Final when the player reached the final', () => {
    const matches = [
      { round: 'R16' }, { round: 'QF' }, { round: 'SF' }, { round: 'Final' },
    ]
    expect(mostAdvancedRound(matches)).toBe('Final')
  })

  it('picks Semis when the player lost in the semis', () => {
    const matches = [{ round: 'R32' }, { round: 'R16' }, { round: 'QF' }, { round: 'SF' }]
    expect(mostAdvancedRound(matches)).toBe('Semis')
  })

  it('matches prefix-insensitively (Quarter-final vs QF)', () => {
    expect(mostAdvancedRound([{ round: 'Quarter-final' }])).toBe('Quarters')
    expect(mostAdvancedRound([{ round: 'Semi-final' }])).toBe('Semis')
  })

  it('handles case-insensitive matching', () => {
    expect(mostAdvancedRound([{ round: 'sf' }])).toBe('Semis')
  })

  it('returns null for unrecognized rounds', () => {
    expect(mostAdvancedRound([{ round: 'Group stage' }])).toBeNull()
    expect(mostAdvancedRound([{ round: null }])).toBeNull()
  })

  it('returns null for empty list', () => {
    expect(mostAdvancedRound([])).toBeNull()
  })
})

describe('roundRank', () => {
  it('ranks main-draw rounds from most to least advanced', () => {
    expect(roundRank('Final')).toBeLessThan(roundRank('Semifinals'))
    expect(roundRank('Semifinals')).toBeLessThan(roundRank('Quarterfinals'))
    expect(roundRank('Quarterfinals')).toBeLessThan(roundRank('R16'))
    expect(roundRank('R16')).toBeLessThan(roundRank('R32'))
    expect(roundRank('R32')).toBeLessThan(roundRank('R64'))
    expect(roundRank('R64')).toBeLessThan(roundRank('R128'))
  })

  it('ranks qualifying rounds below the entire main draw', () => {
    expect(roundRank('R128')).toBeLessThan(roundRank('Q3'))
    expect(roundRank('Q3')).toBeLessThan(roundRank('Q2'))
    expect(roundRank('Q2')).toBeLessThan(roundRank('Q1'))
  })

  it('treats round aliases as equivalent', () => {
    expect(roundRank('F')).toBe(roundRank('Final'))
    expect(roundRank('SF')).toBe(roundRank('Semifinals'))
    expect(roundRank('QF')).toBe(roundRank('Quarter-final'))
    expect(roundRank('Round of 16')).toBe(roundRank('R16'))
  })

  it('is case-insensitive', () => {
    expect(roundRank('final')).toBe(roundRank('FINAL'))
    expect(roundRank('q1')).toBe(roundRank('Q1'))
  })

  it('returns 99 for null/unknown', () => {
    expect(roundRank(null)).toBe(99)
    expect(roundRank(undefined)).toBe(99)
    expect(roundRank('Group stage')).toBe(99)
  })
})

describe('mostAdvancedRoundEntry', () => {
  it('picks the most-advanced round from a mixed list', () => {
    const matches = [
      { round: 'SemiFinals' },
      { round: 'Final' },
      { round: 'SemiFinals' },
    ]
    expect(mostAdvancedRoundEntry(matches)).toEqual({ round: 'Final', rank: 0 })
  })

  it('returns the raw round string (not a label)', () => {
    // Important — chip rendering needs the raw round to derive the i18n key
    expect(mostAdvancedRoundEntry([{ round: 'Quarter-final' }])).toEqual({
      round: 'Quarter-final',
      rank: 2,
    })
  })

  it('handles all-qualifying tournaments', () => {
    const matches = [{ round: 'Q1' }, { round: 'Q1' }, { round: 'Q2' }]
    const result = mostAdvancedRoundEntry(matches)
    expect(result.round).toBe('Q2')
    expect(result.rank).toBe(8)
  })

  it('returns null + 99 for empty list', () => {
    expect(mostAdvancedRoundEntry([])).toEqual({ round: null, rank: 99 })
  })

  it('returns null + 99 when no rounds are recognised', () => {
    expect(
      mostAdvancedRoundEntry([{ round: 'Group stage' }, { round: null }]),
    ).toEqual({ round: null, rank: 99 })
  })
})

describe('stageChipKey', () => {
  it('maps main-draw rounds to canonical i18n keys', () => {
    expect(stageChipKey('Final')).toBe('final')
    expect(stageChipKey('F')).toBe('final')
    expect(stageChipKey('Finals')).toBe('final')
    expect(stageChipKey('SemiFinals')).toBe('semifinals')
    expect(stageChipKey('SF')).toBe('semifinals')
    expect(stageChipKey('Semi-final')).toBe('semifinals')
    expect(stageChipKey('Quarterfinals')).toBe('quarterfinals')
    expect(stageChipKey('QF')).toBe('quarterfinals')
    expect(stageChipKey('R16')).toBe('r16')
    expect(stageChipKey('Round of 16')).toBe('r16')
    expect(stageChipKey('R32')).toBe('r32')
    expect(stageChipKey('R64')).toBe('r64')
    expect(stageChipKey('R128')).toBe('r128')
  })

  it('groups all qualifying rounds under one key', () => {
    expect(stageChipKey('Q1')).toBe('qualifying')
    expect(stageChipKey('Q2')).toBe('qualifying')
    expect(stageChipKey('Q3')).toBe('qualifying')
  })

  it('is case-insensitive', () => {
    expect(stageChipKey('FINAL')).toBe('final')
    expect(stageChipKey('q1')).toBe('qualifying')
  })

  it('returns null for null / unknown / empty', () => {
    expect(stageChipKey(null)).toBeNull()
    expect(stageChipKey(undefined)).toBeNull()
    expect(stageChipKey('Group stage')).toBeNull()
  })
})
