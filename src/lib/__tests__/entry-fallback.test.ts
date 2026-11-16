import { describe, it, expect } from 'vitest'
import { entriesFromDraw, entriesWithoutProjection } from '../entry-fallback'
import type { Match } from '@/types/match'
const player = (id: string, name: string) => ({ id, name, country: 'AR' })
const match = (extra = {}) => ({ id: 'r16', round: 'R16', pair1_seed: 1,
  pair1_player1: player('osoro', 'Aranzazu Osoro'), pair1_player2: player('', 'Claudia Jensen'),
  pair2_player1: null, pair2_player2: null, ...extra }) as unknown as Match

describe('published entries independent of predictions', () => {
  it('keeps seed one with an unresolved partner and no fabricated identity', () => {
    const entries = entriesFromDraw([match()], 'women')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ seed: 1, player2_name: 'Claudia Jensen', player2_id: null })
    expect(entriesWithoutProjection(entries, new Set(['other::pair']))).toEqual(entries)
  })
  it('deduplicates later rounds and reversed partners, preferring resolved IDs', () => {
    const entries = entriesFromDraw([match(), match({ round: 'QF', pair1_player1: player('jensen', 'Claudia Jensen'), pair1_player2: player('osoro', 'Aranzazu Osoro') })], 'women')
    expect(entries).toHaveLength(1)
    expect(entriesWithoutProjection(entries, new Set(['jensen::osoro']))).toEqual([])
  })
  it('excludes qualifying seeds and empty bracket cells, but retains quarterfinals', () => {
    expect(entriesFromDraw([match({round:'Q1'}), match({pair1_player2:null})], 'women')).toEqual([])
    expect(entriesFromDraw([match({round:'Quarterfinals'})], 'women')).toHaveLength(1)
  })
})
