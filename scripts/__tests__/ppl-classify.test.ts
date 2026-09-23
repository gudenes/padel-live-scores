import { describe, it, expect } from 'vitest'
import { classifyRoster, normalizeForMatch, type ExistingPlayer } from '../lib/ppl-classify'
import type { PplPlayer } from '../lib/ppl-source'

const p = (slug: string, name: string, sex = 'male'): PplPlayer =>
  ({ slug, name, sex, league: 'ppl', status: 'active' })

const e = (id: string, name: string, category = 'men'): ExistingPlayer =>
  ({ id, name, normalized_name: normalizeForMatch(name), category, tier: 'pro' })

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
