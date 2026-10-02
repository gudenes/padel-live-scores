import { describe, it, expect } from 'vitest'
import { validateCoachPatch, sortByImpact } from '../coaches'

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

describe('sortByImpact', () => {
  it('sorts by combined total points, descending', () => {
    const rows = [
      { id: 'a', a: { total_points: 10 }, b: { total_points: 5 } },
      { id: 'b', a: { total_points: 100 }, b: { total_points: 0 } },
    ]
    expect(sortByImpact(rows).map((r) => r.id)).toEqual(['b', 'a'])
  })
})
