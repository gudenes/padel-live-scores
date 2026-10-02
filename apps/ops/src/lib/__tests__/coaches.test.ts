import { describe, it, expect } from 'vitest'
import { validateCoachPatch, isUuid, normalizeCoachName, escapeLike } from '../coaches'

describe('validateCoachPatch', () => {
  it('accepts allow-listed fields and trims strings', () => {
    expect(validateCoachPatch({ display_name: '  Gaby Reca ', status: 'verified', notes: '' })).toEqual({
      ok: true,
      update: { display_name: 'Gaby Reca', status: 'verified', notes: null },
    })
  })
  it('rejects status=merged (only merge_coaches may set it)', () => {
    expect(validateCoachPatch({ status: 'merged' })).toEqual({ ok: false, error: 'invalid status' })
  })
  it('rejects an empty display name', () => {
    expect(validateCoachPatch({ display_name: '   ' })).toEqual({ ok: false, error: 'display_name cannot be empty' })
  })
  it('accepts player_id uuid or null and rejects garbage', () => {
    expect(validateCoachPatch({ player_id: null })).toEqual({ ok: true, update: { player_id: null } })
    expect(validateCoachPatch({ player_id: '6f1c2b0e-8d1a-4c47-9a53-2f4f4b1b1c11' }).ok).toBe(true)
    expect(validateCoachPatch({ player_id: 'nope' })).toEqual({ ok: false, error: 'invalid player_id' })
  })
  it('ignores unknown fields and rejects an empty patch', () => {
    expect(validateCoachPatch({ slug: 'x', normalized_name: 'y' })).toEqual({ ok: false, error: 'nothing to update' })
  })
  it('uppercases a 2-letter country and rejects other lengths', () => {
    expect(validateCoachPatch({ country: 'es' })).toEqual({ ok: true, update: { country: 'ES' } })
    expect(validateCoachPatch({ country: 'ESP' })).toEqual({ ok: false, error: 'country must be ISO alpha-2' })
  })
})

describe('isUuid', () => {
  it('accepts uuids only', () => {
    expect(isUuid('6f1c2b0e-8d1a-4c47-9a53-2f4f4b1b1c11')).toBe(true)
    expect(isUuid('nope')).toBe(false)
    expect(isUuid(null)).toBe(false)
    expect(isUuid(5)).toBe(false)
  })
})

describe('normalizeCoachName', () => {
  it('strips diacritics and apostrophes', () => {
    expect(normalizeCoachName('Martín D’antonio')).toBe('martin dantonio')
    expect(normalizeCoachName("Martin D'Antonio")).toBe('martin dantonio')
  })
  it('collapses punctuation and trims', () => {
    expect(normalizeCoachName('  Juan-Carlos  Gómez. ')).toBe('juan carlos gomez')
  })
})

describe('escapeLike', () => {
  it('escapes backslash, percent and underscore', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d')
    expect(escapeLike('plain')).toBe('plain')
  })
})
