import { describe, expect, it } from 'vitest'
import { worldCupTeamDestination, type CupLinkedMatch } from '../world-cup-team-link'
import { WORLD_CUP, type CupData } from '../world-cup'

const data = { teams: [{ name: 'Italy', country: 'IT', category: 'men', players: [] }] } as unknown as CupData
const match = { tournament: { id: WORLD_CUP.tournamentId }, category: 'men', pair1_player1: { country: 'IT' }, pair1_player2: { country: 'IT' } } as CupLinkedMatch
describe('World Cup selection links', () => {
  it('uses original match countries for both teams even without linked player profiles', () => {
    const squads = { teams: [...data.teams, { name: 'Indonesia', country: 'INA', category: 'women', players: [] }] } as unknown as CupData
    const row = { ...match, category: 'women', pair2_player1: null, pair2_player2: null, pair2_player1_country: 'INA', pair2_player2_country: 'INA' } as CupLinkedMatch
    expect(worldCupTeamDestination(row, 2, squads)?.country).toBe('ID')
  })
  it('preserves the edition, category and country', () => {
    expect(worldCupTeamDestination(match, 1, data)?.href).toBe(`/tournaments/${WORLD_CUP.tournamentId}?tab=teams&category=men&team=IT`)
  })
  it('prioritizes recorded match countries over conflicting linked profiles', () => {
    const row = { ...match, pair1_player1_country: 'ITA', pair1_player2_country: 'ITA', pair1_player1: { country: 'MX' }, pair1_player2: { country: 'MX' } } as CupLinkedMatch
    expect(worldCupTeamDestination(row, 1, data)?.country).toBe('IT')
  })
  it('does not hide disagreement in recorded countries behind matching profiles', () => {
    expect(worldCupTeamDestination({ ...match, pair1_player1_country: 'ITA', pair1_player2_country: 'MEX' }, 1, data)).toBeNull()
  })
  it('does not guess when partners disagree or the country is missing', () => {
    expect(worldCupTeamDestination({ ...match, pair1_player2: { country: 'MX' } } as CupLinkedMatch, 1, data)).toBeNull()
    expect(worldCupTeamDestination({ ...match, pair1_player2: null }, 1, data)).toBeNull()
  })
  it('requires the correct event and a squad in the same category', () => {
    expect(worldCupTeamDestination({ ...match, tournament: { id: 'other' } }, 1, data)).toBeNull()
    expect(worldCupTeamDestination({ ...match, category: 'women' }, 1, data)).toBeNull()
    expect(worldCupTeamDestination(match, 1, null)).toBeNull()
  })
})
