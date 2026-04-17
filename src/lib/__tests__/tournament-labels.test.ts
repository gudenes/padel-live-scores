import { describe, expect, it } from 'vitest'
import { levelLabel, mostAdvancedRound, ROUND_ORDER, ROUND_LABELS } from '../tournament-labels'

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
