import { describe, it, expect } from 'vitest'
import { classifyRoster, normalizeForMatch, type ExistingPlayer } from '../lib/ppl-classify'
import type { PplPlayer } from '../lib/ppl-source'

const p = (slug: string, name: string, sex = 'male'): PplPlayer =>
  ({ slug, name, sex, league: 'ppl', status: 'active' })

const e = (id: string, name: string, category = 'men', display_name: string | null = null): ExistingPlayer =>
  ({ id, name, display_name, normalized_name: normalizeForMatch(name), category, tier: 'pro' })

describe('normalizeForMatch', () => {
  it('strips accents, case and punctuation', () => {
    expect(normalizeForMatch('Delfina Breá Senesi')).toBe('delfina brea senesi')
    expect(normalizeForMatch('ALEJANDRO "ALEX" RUIZ')).toBe('alejandro alex ruiz')
  })
})

describe('classifyRoster', () => {
  it('puts an already-registered slug in linked, regardless of name', () => {
    const r = classifyRoster(
      [p('federico-chingotto', 'Fede Chingotto')],
      [e('uuid-1', 'Federico Chingotto')],
      new Map([['federico-chingotto', 'uuid-1']]),
      new Map(),
    )
    expect(r.linked).toHaveLength(1)
    expect(r.linked[0].playerId).toBe('uuid-1')
    expect(r.toCreate).toHaveLength(0)
    expect(r.ambiguous).toHaveLength(0)
  })

  it('links on a single exact normalized-name match', () => {
    const r = classifyRoster([p('david-gala', 'David Gala')], [e('uuid-2', 'David Gala')], new Map(), new Map())
    expect(r.toLink).toHaveLength(1)
    expect(r.toLink[0].playerId).toBe('uuid-2')
  })

  it('flags AMBIGUOUS when two existing players share a normalized name', () => {
    const r = classifyRoster(
      [p('claudia-jensen', 'Claudia Jensen', 'female')],
      [e('uuid-a', 'Claudia Jensen', 'women'), e('uuid-b', 'Claudia Jensen', 'women')],
      new Map(), new Map(),
    )
    expect(r.ambiguous).toHaveLength(1)
    expect(r.ambiguous[0].candidates.map((c) => c.id).sort()).toEqual(['uuid-a', 'uuid-b'])
    expect(r.toLink).toHaveLength(0)
    expect(r.toCreate).toHaveLength(0)
  })

  it('an explicit override resolves an ambiguous name', () => {
    const r = classifyRoster(
      [p('claudia-jensen', 'Claudia Jensen', 'female')],
      [e('uuid-a', 'Claudia Jensen', 'women'), e('uuid-b', 'Claudia Jensen', 'women')],
      new Map(),
      new Map([['claudia-jensen', 'uuid-b']]),
    )
    expect(r.ambiguous).toHaveLength(0)
    expect(r.toLink).toHaveLength(1)
    expect(r.toLink[0].playerId).toBe('uuid-b')
  })

  it('puts a genuinely unknown name in toCreate', () => {
    const r = classifyRoster([p('shannon-hudson', 'Shannon Hudson', 'female')], [], new Map(), new Map())
    expect(r.toCreate).toHaveLength(1)
    expect(r.toCreate[0].category).toBe('women')
  })

  it('never matches an amateur-tier player', () => {
    const amateur: ExistingPlayer = { ...e('uuid-am', 'Luis Estrada'), tier: 'amateur' }
    const r = classifyRoster([p('luis-estrada', 'Luis Estrada')], [amateur], new Map(), new Map())
    expect(r.toCreate).toHaveLength(1)
    expect(r.toLink).toHaveLength(0)
  })

  it('does not cross gender when matching', () => {
    const r = classifyRoster(
      [p('alex-ruiz', 'Alex Ruiz', 'female')],
      [e('uuid-m', 'Alex Ruiz', 'men')],
      new Map(), new Map(),
    )
    expect(r.toCreate).toHaveLength(1)
    expect(r.toLink).toHaveLength(0)
  })

  it('maps sex to category', () => {
    const r = classifyRoster([p('x', 'New Person', 'female')], [], new Map(), new Map())
    expect(r.toCreate[0].category).toBe('women')
  })

  it('prefers the registered slug over a conflicting name match', () => {
    // The sidecar registration is authoritative. If a slug is already mapped
    // to uuid-1, a same-name row at uuid-OTHER must not win or produce
    // ambiguity — this is what makes re-runs stable.
    const r = classifyRoster(
      [p('david-gala', 'David Gala')],
      [e('uuid-1', 'David Gala'), e('uuid-OTHER', 'David Gala')],
      new Map([['david-gala', 'uuid-1']]),
      new Map(),
    )
    expect(r.linked).toHaveLength(1)
    expect(r.linked[0].playerId).toBe('uuid-1')
    expect(r.ambiguous).toHaveLength(0)
  })
})

// Tiers 2 and 3. Every fixture here is chosen so the tiers DISAGREE — a case
// where all tiers give the same answer would pass against a broken
// implementation and prove nothing.
describe('display_name as a subset source', () => {
  it('matches a nickname that the canonical name alone cannot reach', () => {
    // Real row: our name is "Francisco Navarro", display_name "Paquito
    // Navarro". PPL publishes the nickname form. Tier 1 misses, and the
    // subset tier misses against `name` — {paquito, navarro} is NOT a subset
    // of {francisco, navarro}. It only resolves because the subset tier also
    // reads display_name. Drop that and this test fails; that is the point.
    const r = classifyRoster(
      [p('paquito-navarro', 'Paquito Navarro')],
      [e('uuid-n', 'Francisco Navarro', 'men', 'Paquito Navarro')],
      new Map(), new Map(),
    )
    expect(r.toLink).toHaveLength(1)
    expect(r.toLink[0].playerId).toBe('uuid-n')
    expect(r.toCreate).toHaveLength(0)
  })
})

describe('token subset tier', () => {
  it('matches the short form against our fuller canonical name', () => {
    // PPL "Ariana Sanchez" ⊂ our "Ariana Sanchez Fallada". Note our
    // display_name is "Ari Sanchez", which does NOT match either — so this
    // can only pass via the subset tier.
    const r = classifyRoster(
      [p('ariana-sanchez', 'Ariana Sanchez', 'female')],
      [e('uuid-a', 'Ariana Sanchez Fallada', 'women', 'Ari Sanchez')],
      new Map(), new Map(),
    )
    expect(r.toLink).toHaveLength(1)
    expect(r.toLink[0].playerId).toBe('uuid-a')
  })

  it('matches in the REVERSE direction when our row is the shorter one', () => {
    // Real case: PPL "Javier Gomez Garrido" against our "Javier Garrido",
    // world No. 20. The one-directional version shipped first and missed 13
    // players like this, including two top-40s.
    const r = classifyRoster(
      [p('javier-gomez-garrido', 'Javier Gomez Garrido')],
      [e('uuid-g', 'Javier Garrido')],
      new Map(), new Map(),
    )
    expect(r.toLink).toHaveLength(1)
    expect(r.toLink[0].playerId).toBe('uuid-g')
  })

  it('a one-token row never swallows a longer PPL name', () => {
    // The guard that makes the reverse direction safe. Our bare "Marta"
    // must not absorb PPL's "Marta Ortega".
    const r = classifyRoster(
      [p('marta-ortega', 'Marta Ortega', 'female')],
      [e('uuid-m', 'Marta', 'women')],
      new Map(), new Map(),
    )
    expect(r.toCreate).toHaveLength(1)
    expect(r.toLink).toHaveLength(0)
  })

  it('a one-token PPL name never matches a longer row either', () => {
    const r = classifyRoster(
      [p('garrido', 'Garrido')],
      [e('uuid-g', 'Javier Garrido')],
      new Map(), new Map(),
    )
    expect(r.toCreate).toHaveLength(1)
    expect(r.toLink).toHaveLength(0)
  })

  it('refuses a single-token name so a bare surname cannot match', () => {
    const r = classifyRoster(
      [p('triay', 'Triay', 'female')],
      [e('uuid-t', 'Gemma Triay Pons', 'women')],
      new Map(), new Map(),
    )
    expect(r.toCreate).toHaveLength(1)
    expect(r.toLink).toHaveLength(0)
  })

  it('two subset survivors are AMBIGUOUS, never an automatic pick', () => {
    const r = classifyRoster(
      [p('marta-ortega', 'Marta Ortega', 'female')],
      [e('uuid-1', 'Marta Ortega Ruiz', 'women'), e('uuid-2', 'Marta Ortega Lopez', 'women')],
      new Map(), new Map(),
    )
    expect(r.ambiguous).toHaveLength(1)
    expect(r.ambiguous[0].candidates).toHaveLength(2)
    expect(r.toLink).toHaveLength(0)
    expect(r.toCreate).toHaveLength(0)
  })

  it('an exact hit wins over a looser subset hit', () => {
    // 'David Gala' matches uuid-exact exactly AND uuid-longer by subset.
    // Tier 1 must short-circuit, otherwise this would be ambiguous.
    const r = classifyRoster(
      [p('david-gala', 'David Gala')],
      [e('uuid-exact', 'David Gala'), e('uuid-longer', 'David Gala Moreno')],
      new Map(), new Map(),
    )
    expect(r.toLink).toHaveLength(1)
    expect(r.toLink[0].playerId).toBe('uuid-exact')
    expect(r.ambiguous).toHaveLength(0)
  })

  it('still never matches an amateur, even via subset', () => {
    const am: ExistingPlayer = { ...e('uuid-am', 'Luis Estrada Ramos'), tier: 'amateur' }
    const r = classifyRoster([p('luis-estrada', 'Luis Estrada')], [am], new Map(), new Map())
    expect(r.toCreate).toHaveLength(1)
  })
})
