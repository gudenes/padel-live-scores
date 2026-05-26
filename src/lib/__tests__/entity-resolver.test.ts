import { describe, expect, it } from 'vitest'
import { resolveEntity, normalizeForSearch } from '../entity-resolver'

describe('normalizeForSearch', () => {
  it('strips diacritics', () => {
    expect(normalizeForSearch('Galán')).toBe('galan')
    expect(normalizeForSearch('Bélla Bréa')).toBe('bella brea')
  })

  it('lowercases and trims', () => {
    expect(normalizeForSearch('  TAPIA  ')).toBe('tapia')
  })
})

describe('resolveEntity — player', () => {
  it('returns null when no rows match', async () => {
    const supabase = mockSupabase({ players: [] })
    const out = await resolveEntity(supabase as any, 'player', 'Nonexistent Player')
    expect(out).toBeNull()
  })

  it('returns the single matching player with full confidence', async () => {
    const supabase = mockSupabase({
      players: [{ id: 'p1', name: 'Agustín Tapia', normalized_name: 'agustin tapia' }],
    })
    const out = await resolveEntity(supabase as any, 'player', 'Tapia')
    expect(out).toEqual({ entityId: 'p1', confidence: expect.any(Number) })
    expect(out!.confidence).toBeGreaterThan(0.7)
  })

  it('downscores confidence when multiple plausible candidates exist', async () => {
    const supabase = mockSupabase({
      players: [
        { id: 'p1', name: 'Agustín Tapia',     normalized_name: 'agustin tapia' },
        { id: 'p2', name: 'Agustín Tapia Jr.', normalized_name: 'agustin tapia jr' },
      ],
    })
    const out = await resolveEntity(supabase as any, 'player', 'Tapia')
    // Two candidates → ambiguous → confidence dampened
    expect(out?.confidence).toBeLessThan(0.7)
  })
})

// Tiny supabase mock — only supports the chain shape used by entity-resolver
function mockSupabase(tables: { players?: any[]; tournaments?: any[]; padel_brands?: any[] }) {
  return {
    from(table: string) {
      const data = (tables as any)[table] ?? []
      const builder: any = {
        select: () => builder,
        ilike: () => builder,
        textSearch: () => builder,
        eq: () => builder,
        limit: () => Promise.resolve({ data, error: null }),
      }
      return builder
    },
  }
}
