import { describe, it, expect } from 'vitest'
import { buildAmateurProfile, type AmateurRawRows } from '../amateur-profile'

const PLAYER_ID = 'p-gustavo'

const RAW: AmateurRawRows = {
  membership: {
    team_season_id: 'ts-1',
    player_id: PLAYER_ID,
    competition_points: 41250,
    competition_rank: 412,
    roster_rank: 9,
    games_played: 7,
    wins: 2,
    losses: 5,
  },
  season: {
    id: 'ts-1',
    team_id: 't-1',
    label: '25/26',
    ranking: 7,
    ties_played: 9,
    ties_won: 3,
    courts_won: 20,
    courts_lost: 25,
    points_for: 46,
    points_against: 62,
    notes: 'Reconstruído do ranking por jornadas da SNP.',
  },
  team: {
    id: 't-1',
    slug: 'blue-padel-mataro',
    name: 'Blue Padel Mataró',
    club: 'Blue Padel',
    city: 'Mataró',
    country: 'ES',
    crest_url: null,
    competition: 'Series Nacionales de Pádel · Barcelona · Masculino 1000',
    category: 'men',
    badge_label: 'Amador · SNP',
    short_name: 'SNP',
  },
  roster: [
    { player_id: PLAYER_ID,  roster_rank: 9, games_played: 7, wins: 2, losses: 5, player: { id: PLAYER_ID,  name: 'Gustavo Denes',  avatar_url: null } },
    { player_id: 'p-abraham', roster_rank: 22, games_played: 0, wins: 0, losses: 0, player: { id: 'p-abraham', name: 'Abraham Torres', avatar_url: null } },
  ],
  fixtures: [
    { id: 'f-1', code: 'J2', label: 'Jornada 2', sort_order: 2, complete: true,  result: 'L', points_for: 0, points_against: 12, courts_won: 0, courts_lost: 5, opponent_name: null, played_on: null },
    { id: 'f-2', code: 'J3', label: 'Jornada 3', sort_order: 3, complete: true,  result: 'L', points_for: 5, points_against: 7,  courts_won: 2, courts_lost: 3, opponent_name: null, played_on: null },
    { id: 'f-3', code: 'POFF', label: 'Playoff', sort_order: 11, complete: false, result: null, points_for: null, points_against: null, courts_won: null, courts_lost: null, opponent_name: null, played_on: null },
  ],
  slots: [
    { id: 's-1', fixture_id: 'f-1', label: 'Pistas 1 y 2', worth: 3, slot_group: 3, result: 'L', sets: 2, court_count: 2, exact: false, partial: false, sort_order: 1, player_ids: [PLAYER_ID, 'p-albert', 'p-jonatan', 'p-william'] },
    { id: 's-2', fixture_id: 'f-2', label: 'Pista 3',      worth: 2, slot_group: 2, result: 'W', sets: 3, court_count: 1, exact: true,  partial: false, sort_order: 3, player_ids: [PLAYER_ID, 'p-gerard'] },
    { id: 's-3', fixture_id: 'f-2', label: 'Pista 4',      worth: 2, slot_group: 2, result: 'L', sets: 2, court_count: 1, exact: true,  partial: false, sort_order: 4, player_ids: ['p-hugo', 'p-pol'] },
    { id: 's-4', fixture_id: 'f-3', label: 'Pista 1',      worth: 3, slot_group: 3, result: 'L', sets: 2, court_count: 1, exact: false, partial: true,  sort_order: 1, player_ids: [PLAYER_ID, 'p-albert', 'p-david'] },
  ],
}

describe('buildAmateurProfile', () => {
  const profile = buildAmateurProfile(PLAYER_ID, RAW)

  it('carries team and season identity through', () => {
    expect(profile.team.name).toBe('Blue Padel Mataró')
    expect(profile.season.label).toBe('25/26')
    expect(profile.season.ranking).toBe(7)
  })

  it('keeps only the slots the player was on, ordered by fixture', () => {
    expect(profile.games.map(g => g.fixtureCode)).toEqual(['J2', 'J3', 'POFF'])
  })

  it('excludes the player themselves from their own partner list', () => {
    const j3 = profile.games.find(g => g.fixtureCode === 'J3')!
    expect(j3.partnerIds).toEqual(['p-gerard'])
  })

  it('marks a multi-court slot as inexact', () => {
    const j2 = profile.games.find(g => g.fixtureCode === 'J2')!
    expect(j2.exact).toBe(false)
    expect(j2.partnerIds).toHaveLength(3)
  })

  it('flags games from partially-recorded fixtures', () => {
    const poff = profile.games.find(g => g.fixtureCode === 'POFF')!
    expect(poff.complete).toBe(false)
  })

  it('derives the record, usual court and partners', () => {
    expect(profile.record).toEqual({ played: 3, wins: 1, losses: 2, winRate: 33 })
    expect(profile.usualCourt).toEqual({ worth: 3, count: 2, total: 3 })
    expect(profile.partners.confirmed).toEqual(['p-gerard'])
  })

  it('keeps roster members who never played', () => {
    const abraham = profile.roster.find(r => r.playerId === 'p-abraham')!
    expect(abraham.gamesPlayed).toBe(0)
  })

  it('groups every slot under its fixture for the team tab', () => {
    const j3 = profile.fixtures.find(f => f.code === 'J3')!
    expect(j3.slots.map(s => s.label)).toEqual(['Pista 3', 'Pista 4'])
  })
})
