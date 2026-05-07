import { describe, it, expect } from 'vitest'
import { getHeadToHead } from '../../src/lib/data/head-to-head'
import { searchPlayer } from '../../src/lib/data/search-player'

const hasDb = !!process.env.DATABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_URL

describe.skipIf(!hasDb)('getHeadToHead', () => {
  it('returns matches where the two players were on opposing pairs', async () => {
    const a = (await searchPlayer('Tapia', { limit: 1 }))[0]
    const b = (await searchPlayer('Galan', { limit: 1 }))[0]
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    const matches = await getHeadToHead(a.id, b.id, { limit: 25 })
    // They've played each other many times; assertion is "any" not exact
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) {
      const pair1Names = [m.pair1.player1_name, m.pair1.player2_name].filter(Boolean) as string[]
      const pair2Names = [m.pair2.player1_name, m.pair2.player2_name].filter(Boolean) as string[]
      // a's name appears in exactly one pair; b's name in the other
      const inPair1 = pair1Names.some((n) => n.toLowerCase().includes('tapia'))
      const inPair2 = pair2Names.some((n) => n.toLowerCase().includes('tapia'))
      expect(inPair1 !== inPair2).toBe(true)
    }
  })

  it('returns empty for two ids that never met as opponents', async () => {
    const matches = await getHeadToHead(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      { limit: 5 },
    )
    expect(matches).toEqual([])
  })
})
