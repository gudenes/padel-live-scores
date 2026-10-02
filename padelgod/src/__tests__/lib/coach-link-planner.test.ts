import { describe, it, expect } from 'vitest'
import { planCoachLinks, type PlannerInput } from '../../lib/coach-link-planner.js'

function ids() {
  let n = 0
  return () => `new-${++n}`
}

const empty = (): PlannerInput => ({
  players: [],
  coaches: [],
  aliases: [],
  existingLinks: [],
})

describe('planCoachLinks', () => {
  it('creates one coach for accent/apostrophe variants and links both players', () => {
    const input = empty()
    input.players = [
      { id: 'p1', coaches: ['Martín D’antonio'] },
      { id: 'p2', coaches: ['Martin Dantonio'] },
    ]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches).toEqual([
      { id: 'new-1', display_name: 'Martín D’antonio', normalized_name: 'martin dantonio', slug: 'martin-dantonio', notes: null },
    ])
    expect(plan.newAliases).toEqual([
      { normalized_alias: 'martin dantonio', coach_id: 'new-1', example_raw: 'Martín D’antonio', source: 'auto' },
    ])
    expect(plan.linksToUpsert).toEqual([
      { player_id: 'p1', coach_id: 'new-1', raw_name: 'Martín D’antonio', position: 0 },
      { player_id: 'p2', coach_id: 'new-1', raw_name: 'Martin Dantonio', position: 0 },
    ])
    expect(plan.linksToDelete).toEqual([])
  })

  it('uses an existing alias, following merged_into', () => {
    const input = empty()
    input.coaches = [
      { id: 'old', normalized_name: 'agustin silingo', display_name: 'Agustin Silingo', slug: 'agustin-silingo', status: 'merged', merged_into: 'keep' },
      { id: 'keep', normalized_name: 'agustin gomez silingo', display_name: 'Agustín Gómez Silingo', slug: 'agustin-gomez-silingo', status: 'verified', merged_into: null },
    ]
    input.aliases = [{ normalized_alias: 'agustin silingo', coach_id: 'old' }]
    input.players = [{ id: 'p1', coaches: ['Agustín Silingo'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches).toEqual([])
    expect(plan.newAliases).toEqual([])
    expect(plan.linksToUpsert).toEqual([{ player_id: 'p1', coach_id: 'keep', raw_name: 'Agustín Silingo', position: 0 }])
    expect(plan.counts.aliasHits).toBe(1)
  })

  it('adds an auto alias when a coach with that normalized name exists but the alias row does not', () => {
    const input = empty()
    input.coaches = [{ id: 'c1', normalized_name: 'pablo pesce', display_name: 'Pablo Pesce', slug: 'pablo-pesce', status: 'unreviewed', merged_into: null }]
    input.players = [{ id: 'p1', coaches: ['Pablo Pesce'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches).toEqual([])
    expect(plan.newAliases).toEqual([{ normalized_alias: 'pablo pesce', coach_id: 'c1', example_raw: 'Pablo Pesce', source: 'auto' }])
  })

  it('is idempotent: a second run over its own output writes nothing', () => {
    const input = empty()
    input.players = [{ id: 'p1', coaches: ['Gustavo Pratto', 'Martin Canali'] }]
    const first = planCoachLinks(input, ids())
    const second = planCoachLinks(
      {
        players: input.players,
        coaches: first.newCoaches.map((c) => ({ ...c, status: 'unreviewed' as const, merged_into: null })),
        aliases: first.newAliases.map((a) => ({ normalized_alias: a.normalized_alias, coach_id: a.coach_id })),
        existingLinks: first.linksToUpsert,
      },
      ids(),
    )
    expect(second.newCoaches).toEqual([])
    expect(second.newAliases).toEqual([])
    expect(second.linksToUpsert).toEqual([])
    expect(second.linksToDelete).toEqual([])
  })

  it('deletes links the player no longer lists, including players whose list became empty', () => {
    const input = empty()
    input.coaches = [
      { id: 'c1', normalized_name: 'old coach', display_name: 'Old Coach', slug: 'old-coach', status: 'unreviewed', merged_into: null },
    ]
    input.aliases = [{ normalized_alias: 'old coach', coach_id: 'c1' }]
    input.existingLinks = [
      { player_id: 'p1', coach_id: 'c1', raw_name: 'Old Coach', position: 0 },
      { player_id: 'p2', coach_id: 'c1', raw_name: 'Old Coach', position: 0 },
    ]
    input.players = [{ id: 'p1', coaches: ['New Coach'] }, { id: 'p2', coaches: [] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.linksToDelete).toEqual([
      { player_id: 'p1', coach_id: 'c1' },
      { player_id: 'p2', coach_id: 'c1' },
    ])
  })

  it('rewrites a link whose raw spelling or position changed', () => {
    const input = empty()
    input.coaches = [{ id: 'c1', normalized_name: 'inigo lopez', display_name: 'Iñigo Lopez', slug: 'inigo-lopez', status: 'unreviewed', merged_into: null }]
    input.aliases = [{ normalized_alias: 'inigo lopez', coach_id: 'c1' }]
    input.existingLinks = [{ player_id: 'p1', coach_id: 'c1', raw_name: 'Iñigo Lopez', position: 0 }]
    input.players = [{ id: 'p1', coaches: ['Iñigo López'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.linksToUpsert).toEqual([{ player_id: 'p1', coach_id: 'c1', raw_name: 'Iñigo López', position: 0 }])
  })

  it('keeps junk coaches resolving (junk is a status, not a deletion)', () => {
    const input = empty()
    input.coaches = [{ id: 'j', normalized_name: 'manual', display_name: 'Manual', slug: 'manual', status: 'junk', merged_into: null }]
    input.aliases = [{ normalized_alias: 'manual', coach_id: 'j' }]
    input.players = [{ id: 'p1', coaches: ['Manual'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches).toEqual([])
    expect(plan.linksToUpsert).toEqual([{ player_id: 'p1', coach_id: 'j', raw_name: 'Manual', position: 0 }])
  })

  it('flags single-token names and dedupes slugs', () => {
    const input = empty()
    input.coaches = [{ id: 'c1', normalized_name: 'juan alday x', display_name: 'X', slug: 'juan', status: 'unreviewed', merged_into: null }]
    input.players = [{ id: 'p1', coaches: ['Juan'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches[0].slug).toBe('juan-2')
    expect(plan.newCoaches[0].notes).toBe('single-token name — check if junk')
  })

  it('links a coach once per player even if listed twice under two spellings', () => {
    const input = empty()
    input.players = [{ id: 'p1', coaches: ['Matías Díaz', 'Matias Diaz'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.linksToUpsert).toEqual([{ player_id: 'p1', coach_id: 'new-1', raw_name: 'Matías Díaz', position: 0 }])
  })

  it('skips raw strings that normalize to empty', () => {
    const input = empty()
    input.players = [{ id: 'p1', coaches: [' - '] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches).toEqual([])
    expect(plan.linksToUpsert).toEqual([])
  })

  const mc = (id: string, name: string, status: 'merged' | 'unreviewed' | 'verified', merged_into: string | null, slug = id) => ({
    id, normalized_name: name, display_name: name, slug, status, merged_into,
  })

  it('falls back to a merged coach by normalized name (no alias) and follows the chain', () => {
    const input = empty()
    input.coaches = [mc('m', 'bob dylan', 'merged', 't'), mc('t', 'robert dylan', 'verified', null)]
    input.players = [{ id: 'p1', coaches: ['Bob Dylan'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches).toEqual([])
    expect(plan.linksToUpsert).toEqual([{ player_id: 'p1', coach_id: 't', raw_name: 'Bob Dylan', position: 0 }])
    expect(plan.newAliases).toEqual([{ normalized_alias: 'bob dylan', coach_id: 't', example_raw: 'Bob Dylan', source: 'auto' }])
  })

  it('follows a multi-hop alias chain A->B->C', () => {
    const input = empty()
    input.coaches = [mc('a', 'aa bb', 'merged', 'b'), mc('b', 'bb cc', 'merged', 'c'), mc('c', 'cc dd', 'verified', null)]
    input.aliases = [{ normalized_alias: 'aa bb', coach_id: 'a' }]
    input.players = [{ id: 'p1', coaches: ['Aa Bb'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.linksToUpsert.map((l) => l.coach_id)).toEqual(['c'])
    expect(plan.counts.unresolvable).toBe(0)
  })

  it('skips raw strings whose merge chain does not end on a live coach', () => {
    const input = empty()
    input.coaches = [mc('a', 'aa bb', 'merged', 'ghost')]
    input.aliases = [{ normalized_alias: 'aa bb', coach_id: 'a' }]
    input.players = [{ id: 'p1', coaches: ['Aa Bb'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.linksToUpsert).toEqual([])
    expect(plan.newCoaches).toEqual([])
    expect(plan.counts.unresolvable).toBe(1)
  })

  it('skips merge cycles', () => {
    const input = empty()
    input.coaches = [mc('a', 'aa bb', 'merged', 'b'), mc('b', 'bb cc', 'merged', 'a')]
    input.aliases = [{ normalized_alias: 'aa bb', coach_id: 'a' }]
    input.players = [{ id: 'p1', coaches: ['Aa Bb'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.linksToUpsert).toEqual([])
    expect(plan.counts.unresolvable).toBe(1)
  })

  it('aliasHits ignores aliases created earlier in the same run', () => {
    const input = empty()
    input.players = [
      { id: 'p1', coaches: ['New Coach'] },
      { id: 'p2', coaches: ['New Coach'] },
    ]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches).toHaveLength(1)
    expect(plan.counts.aliasHits).toBe(0)
    expect(plan.counts.rawStrings).toBe(2)
  })

  it('collapses internal whitespace in example_raw but not in link raw_name', () => {
    const input = empty()
    input.players = [{ id: 'p1', coaches: ['  Juan   Perez '] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.newAliases[0]?.example_raw).toBe('Juan Perez')
    expect(plan.linksToUpsert[0]?.raw_name).toBe('  Juan   Perez ')
  })

  it('suffixes the slug when it collides with a merged coach slug', () => {
    const input = empty()
    input.coaches = [mc('m', 'other name', 'merged', null, 'juan-perez')]
    input.players = [{ id: 'p1', coaches: ['Juan Perez'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches[0]?.slug).toBe('juan-perez-2')
  })
})
