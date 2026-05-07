import { describe, it, expect } from 'vitest'
import { searchPlayer } from '../../src/lib/data/search-player'

const hasDb = !!process.env.DATABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_URL

describe.skipIf(!hasDb)('searchPlayer', () => {
  it('returns at least one candidate for a known surname', async () => {
    const results = await searchPlayer('Tapia', { limit: 5 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toHaveProperty('id')
    expect(results[0]).toHaveProperty('name')
    // Tapia should be in there somewhere
    const names = results.map((r) => r.name.toLowerCase())
    expect(names.some((n) => n.includes('tapia'))).toBe(true)
  })

  it('returns empty array for nonsense', async () => {
    const results = await searchPlayer('zzzzzznonexistentzzzzzz', { limit: 5 })
    expect(results).toEqual([])
  })

  it('caps at limit', async () => {
    const results = await searchPlayer('a', { limit: 3 })
    expect(results.length).toBeLessThanOrEqual(3)
  })
})
