import { it, expect, vi } from 'vitest'
import { PlayerResolver } from '../player-resolver'
import { getMatchDisplay, type Match } from '../../types/match'

it('the app PlayerResolver uses strict country-aware lookup without writes', async () => {
  const writes = vi.fn()
  const rows = [
    { id: 'cl', name: 'Mateo Alvarez', normalized_name: 'mateo alvarez', country: 'CL', category: 'men', tier: 'pro' },
    { id: 'ar', name: 'Mateo Alvarez', normalized_name: 'mateo alvarez', country: 'AR', category: 'men', tier: 'pro' },
  ]
  const db = { from(table: string) {
    const chain: any = { select: () => chain, neq: () => chain, eq: () => chain,
      range: () => Promise.resolve({ data: table === 'players' ? rows : [], error: null }), upsert: writes, insert: writes, update: writes }
    return chain
  } }
  const resolver = new PlayerResolver(db as any)
  expect(await resolver.lookup({ name: 'Mateo Alvarez', category: 'men', country: 'ARG' }, { strict: true })).toMatchObject({ found: true, playerId: 'ar' })
  expect(writes).not.toHaveBeenCalled()
})

it('shows serving pair and current points without inventing an individual server', () => {
  const match = { status: 'live', pair1_player1: { id: 'one' }, pair1_player2: { id: 'two' },
    pair2_player1: { id: 'three' }, pair2_player2: { id: 'four' }, sets: [{ set_number: 1, is_current: true, pair1_games: 2, pair2_games: 3,
      games: [{ game_number: 6, is_current: true, points: null, game_score: '15-40', server_player_id: null, serving_pair: 2 }] }] } as unknown as Match
  expect(getMatchDisplay(match)).toMatchObject({ livePoint: '15-40', serverPlayerId: null, pair1Serving: false, pair2Serving: true })
})
