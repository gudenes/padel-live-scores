// src/lib/__tests__/fip-stream-title-parser.test.ts
import { describe, it, expect } from 'vitest'
import { parseFipStreamTitle } from '../fip-stream-title-parser'

describe('parseFipStreamTitle', () => {
  it('parses standard "FIP Silver Mendoza | Day 3 | Center Court" format', () => {
    const r = parseFipStreamTitle('FIP Silver Mendoza | Day 3 | Center Court')
    expect(r.tier).toBe('silver')
    expect(r.day).toBe(3)
    expect(r.court).toBe('center court')
    expect(r.tournamentTokens).toEqual(['mendoza'])
  })

  it('parses dash-separated all-caps "FIP GOLD ALMATY - DAY 4 - CENTRAL COURT"', () => {
    const r = parseFipStreamTitle('FIP GOLD ALMATY - DAY 4 - CENTRAL COURT')
    expect(r.tier).toBe('gold')
    expect(r.day).toBe(4)
    expect(r.court).toBe('central court')
    expect(r.tournamentTokens).toEqual(['almaty'])
  })

  it('parses "FIP Bronze Genova Day 1 Court 2"', () => {
    const r = parseFipStreamTitle('FIP Bronze Genova Day 1 Court 2')
    expect(r.tier).toBe('bronze')
    expect(r.day).toBe(1)
    expect(r.court).toBe('court 2')
    expect(r.tournamentTokens).toEqual(['genova'])
  })

  it('parses Spanish "Día" day label', () => {
    const r = parseFipStreamTitle('FIP Silver Buenos Aires - Día 2 - Pista Central')
    expect(r.tier).toBe('silver')
    expect(r.day).toBe(2)
    expect(r.court).toBe('pista central')
    expect(r.tournamentTokens).toEqual(['buenos', 'aires'])
  })

  it('returns null tier for non-FIP titles', () => {
    const r = parseFipStreamTitle('Mendoza Padel Cup - Live')
    expect(r.tier).toBeNull()
    expect(r.tournamentTokens).toEqual(['mendoza'])
  })

  it('returns null day when missing', () => {
    const r = parseFipStreamTitle('FIP Gold Almaty - Center Court')
    expect(r.day).toBeNull()
    expect(r.court).toBe('center court')
  })

  it('returns null court when missing', () => {
    const r = parseFipStreamTitle('FIP Silver Mendoza - Day 3')
    expect(r.court).toBeNull()
  })

  it('strips trailing year tokens from tournament', () => {
    const r = parseFipStreamTitle('FIP Gold Almaty 2026 - Day 1 - Centre Court')
    expect(r.tournamentTokens).toEqual(['almaty'])
  })

  it('lowercases and trims diacritics from tournament tokens', () => {
    const r = parseFipStreamTitle('FIP Silver São Paulo - Day 2 - Pista Central')
    expect(r.tournamentTokens).toContain('sao')
    expect(r.tournamentTokens).toContain('paulo')
  })
})
