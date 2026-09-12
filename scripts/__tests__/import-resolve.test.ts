// scripts/__tests__/import-resolve.test.ts
// The import matched players by normalised name. That is fragile in one
// specific way: fixing an accent in the spreadsheet creates a second player
// and orphans the first one's history. The SNP id closes that.
import { describe, it, expect } from 'vitest'
import { resolvePlayerId, type ResolutionIndex } from '../lib/amateur-resolve'

const INDEX: ResolutionIndex = {
  bySnpId: new Map([['319382', 'uuid-david']]),
  byNormalizedName: new Map([['david diaz dangla', 'uuid-david']]),
}

describe('resolvePlayerId', () => {
  it('matches by SNP id', () => {
    expect(resolvePlayerId(INDEX, '319382', 'David Diaz Dangla')).toBe('uuid-david')
  })

  it('matches the SAME player when the name gains an accent', () => {
    // The whole point. Without the id this returns null and the caller
    // creates a duplicate.
    expect(resolvePlayerId(INDEX, '319382', 'David Díaz Dangla')).toBe('uuid-david')
  })

  it('falls back to the normalised name when there is no id', () => {
    expect(resolvePlayerId(INDEX, null, 'DAVID DIAZ DANGLA')).toBe('uuid-david')
  })

  it('returns null for someone genuinely new', () => {
    expect(resolvePlayerId(INDEX, '999999', 'Alguien Nuevo')).toBeNull()
  })

  it('prefers the id over a name that points elsewhere', () => {
    // A renamed player whose new name collides with another row must follow
    // the id, not the collision.
    const idx: ResolutionIndex = {
      bySnpId: new Map([['319382', 'uuid-david']]),
      byNormalizedName: new Map([['david diaz dangla', 'uuid-other']]),
    }
    expect(resolvePlayerId(idx, '319382', 'David Diaz Dangla')).toBe('uuid-david')
  })
})
