import { describe, expect, it } from 'vitest'
import { resolveCupPlayer, type CupPlayerProfile } from '../world-cup-players'
import type { CupTeam } from '../world-cup'
const team: CupTeam = { name: 'Spain', country: 'ESP', category: 'men', players: [] }
const player: CupPlayerProfile = { id: 'one', name: 'Juan Lebrón Chincoa', display_name: 'Juan Lebrón', country: 'ES', category: 'men', avatar_url: null }
describe('World Cup player identity', () => {
  it('resolves accents and public display names within the national team', () => {
    expect(resolveCupPlayer('Juan Lebron', team, [player])?.id).toBe('one')
  })
  it('supports an omitted second surname', () => {
    expect(resolveCupPlayer('Juan Lebron', team, [{ ...player, display_name: null }])?.id).toBe('one')
  })
  it('rejects ambiguous profiles and surname-only guesses', () => {
    expect(resolveCupPlayer('Juan Lebron', team, [player, { ...player, id: 'two' }])).toBeNull()
    expect(resolveCupPlayer('Lebron', team, [player])).toBeNull()
  })
  it('never links a different national team or category', () => {
    expect(resolveCupPlayer('Juan Lebron', team, [{ ...player, country: 'AR' }])).toBeNull()
    expect(resolveCupPlayer('Juan Lebron', team, [{ ...player, category: 'women' }])).toBeNull()
  })
})
