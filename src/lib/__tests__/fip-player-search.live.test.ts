// Live integration tests against padelfip.com — opt-in only.
// Run with: LIVE=1 npx vitest run src/lib/__tests__/fip-player-search.live.test.ts
import { describe, it, expect } from 'vitest'
import { searchFipPlayer } from '../fip-player-search'

const describeLive = process.env.LIVE ? describe : describe.skip

describeLive('searchFipPlayer — live API', () => {
  it('resolves Cléo Carvalho (rank 1736, BRA) via the full-name query', async () => {
    const r = await searchFipPlayer({
      name: 'Cléo Carvalho',
      country: 'BRA',
      category: 'men',
      rankingHint: 2635,
    })
    expect(r?.playerId).toBe('P100312')
    expect(r?.nationality).toBe('BRA')
  })

  it('resolves Genaro Manuel Campuzano Vazquez via the last-2-tokens fallback', async () => {
    // Full-name query returns { error: "No result Found" } — fallback kicks in.
    const r = await searchFipPlayer({
      name: 'Genaro Manuel Campuzano Vazquez',
      country: 'PAR',
      category: 'men',
      rankingHint: 2980,
    })
    expect(r?.playerId).toBe('P203372')
    expect(r?.fullName).toBe('Genaro Manuel Campuzano Vazquez')
  })

  it('resolves Fatima Yuri Kudo Ykkatai (PAR, women)', async () => {
    const r = await searchFipPlayer({
      name: 'Fatima Yuri Kudo Ykkatai',
      country: 'PAR',
      category: 'women',
      rankingHint: 1111,
    })
    expect(r?.playerId).toBe('P208174')
  })

  it('resolves Martina Munimis Spotorno (BRA, women)', async () => {
    const r = await searchFipPlayer({
      name: 'Martina Munimis Spotorno',
      country: 'BRA',
      category: 'women',
      rankingHint: 1419,
    })
    expect(r?.playerId).toBe('P208548')
  })

  it('returns null when the country filter eliminates all candidates', async () => {
    // Cleo Carvalho exists in BRA only; asking for ARG should null.
    const r = await searchFipPlayer({
      name: 'Cleo Carvalho',
      country: 'ARG',
      category: 'men',
    })
    expect(r).toBeNull()
  })
})
