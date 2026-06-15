import { describe, it, expect } from 'vitest'
import { pairSlugFromNames, buildSlugIndex, resolvePairSlug } from '../projection-slug'

const P = (id: string, name: string) => ({ id, name })

describe('pairSlugFromNames', () => {
  it('joins surnames, lowercased, diacritics stripped', () => {
    expect(pairSlugFromNames([P('b', 'Arturo Coello'), P('a', 'Agustín Tapia')]))
      // ordered by id: a (Tapia) then b (Coello)
      .toBe('tapia-coello')
  })

  it('is order-independent (sorts by id)', () => {
    const s1 = pairSlugFromNames([P('a', 'Agustín Tapia'), P('b', 'Arturo Coello')])
    const s2 = pairSlugFromNames([P('b', 'Arturo Coello'), P('a', 'Agustín Tapia')])
    expect(s1).toBe(s2)
  })

  it('uses the last whitespace token as the surname', () => {
    expect(pairSlugFromNames([P('a', 'Juan Lebron'), P('b', 'Ale Galan')]))
      .toBe('lebron-galan')
  })

  it('strips punctuation and collapses dashes', () => {
    expect(pairSlugFromNames([P('a', "Paula Josemaría"), P('b', 'Ari Sánchez')]))
      .toBe('josemaria-sanchez')
  })
})

describe('buildSlugIndex + resolvePairSlug', () => {
  const rows = [
    { pair_key: 'k1', pair_player_ids: ['a', 'b'] },
    { pair_key: 'k2', pair_player_ids: ['c', 'd'] },
  ]
  const nameById = new Map([
    ['a', 'Agustín Tapia'], ['b', 'Arturo Coello'],
    ['c', 'Juan Lebron'], ['d', 'Ale Galan'],
  ])

  it('resolves an exact canonical slug with no redirect', () => {
    const idx = buildSlugIndex(rows, nameById)
    expect(resolvePairSlug(idx, 'tapia-coello')).toEqual({
      pairKey: 'k1', canonicalSlug: 'tapia-coello', redirect: false,
    })
  })

  it('308-redirects a reordered slug to canonical', () => {
    const idx = buildSlugIndex(rows, nameById)
    expect(resolvePairSlug(idx, 'coello-tapia')).toEqual({
      pairKey: 'k1', canonicalSlug: 'tapia-coello', redirect: true,
    })
  })

  it('returns null for an unknown slug', () => {
    const idx = buildSlugIndex(rows, nameById)
    expect(resolvePairSlug(idx, 'nobody-here')).toBeNull()
  })
})

describe('compound surname with internal hyphen', () => {
  // Player 'a' has id 'a', player 'b' has id 'b'.
  // id-sorted order: 'a' first → canonical slug is "garrido-lopez-tapia"
  // (the compound surname "Garrido-Lopez" normalizes to "garrido-lopez")
  const rows = [{ pair_key: 'k3', pair_player_ids: ['a', 'b'] }]
  const nameById = new Map([
    ['a', 'Maria Garrido-Lopez'],
    ['b', 'Agustin Tapia'],
  ])

  it('resolves the canonical slug (compound surname first) with no redirect', () => {
    const idx = buildSlugIndex(rows, nameById)
    // canonical: id 'a' < 'b', so garrido-lopez comes first
    expect(resolvePairSlug(idx, 'garrido-lopez-tapia')).toEqual({
      pairKey: 'k3',
      canonicalSlug: 'garrido-lopez-tapia',
      redirect: false,
    })
  })

  it('resolves the reversed-order slug to same pairKey with redirect', () => {
    const idx = buildSlugIndex(rows, nameById)
    // reversed: tapia first, then garrido-lopez
    expect(resolvePairSlug(idx, 'tapia-garrido-lopez')).toEqual({
      pairKey: 'k3',
      canonicalSlug: 'garrido-lopez-tapia',
      redirect: true,
    })
  })
})
