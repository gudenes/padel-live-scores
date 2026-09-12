// The team-season view feeds /snp/[slug]. Its fixture/roster shaping must be
// the same code the player profile uses — if the two diverge, the uncertain-
// pairing rule diverges with them, and that rule is a claim about real people.
import { describe, it, expect } from 'vitest'
import { buildTeamSeason, buildAmateurProfile, fetchTeamSeason, type AmateurRawRows } from '../amateur-profile'

const RAW: AmateurRawRows = {
  membership: {
    team_season_id: 'ts-1', player_id: 'p-1',
    competition_points: 41250, national_rank: 4397, local_rank: 528, is_captain: false, roster_rank: 5,
    games_played: 2, wins: 1, losses: 1,
  },
  season: {
    id: 'ts-1', team_id: 't-1', label: '25/26', ranking: 7,
    ties_played: 9, ties_won: 3, courts_won: 20, courts_lost: 25,
    points_for: 46, points_against: 62, notes: 'Reconstruído da SNP.',
  },
  team: {
    id: 't-1', slug: 'blue-padel-mataro', name: 'Blue Padel Mataró',
    club: 'Blue Padel', city: 'Mataró', country: 'ES', crest_url: null,
    cover_image_url: null,
    competition: 'Series Nacionales de Pádel', category: 'men',
    badge_label: 'Amador · SNP', short_name: 'SNP',
  },
  roster: [
    { player_id: 'p-1', roster_rank: 5, games_played: 2, wins: 1, losses: 1, is_captain: false, player: { id: 'p-1', name: 'Gustavo Denes', avatar_url: null, country: null } },
    { player_id: 'p-2', roster_rank: 22, games_played: 0, wins: 0, losses: 0, is_captain: false, player: { id: 'p-2', name: 'Wenjie Zhou', avatar_url: null, country: null } },
  ],
  fixtures: [
    { id: 'f-1', code: 'J1', label: 'Jornada 1', sort_order: 1, complete: true, result: 'W', points_for: 9, points_against: 3, courts_won: 4, courts_lost: 1, opponent_name: null, played_on: null },
  ],
  slots: [
    { id: 's-1', fixture_id: 'f-1', label: 'Pista 1', worth: 3, slot_group: 3, result: 'W', sets: 3, court_count: 1, exact: true, partial: false, sort_order: 1, player_ids: ['p-1', 'p-9'] },
    { id: 's-2', fixture_id: 'f-1', label: 'Pistas 3 y 4', worth: 2, slot_group: 2, result: 'W', sets: 2, court_count: 2, exact: true, partial: false, sort_order: 3, player_ids: ['p-2', 'p-3', 'p-4', 'p-5'] },
  ],
}

describe('buildTeamSeason', () => {
  const team = buildTeamSeason(RAW)

  it('carries team and season identity', () => {
    expect(team.team.name).toBe('Blue Padel Mataró')
    expect(team.season.ties_won).toBe(3)
  })

  it('keeps roster members who never played, ordered by roster rank', () => {
    expect(team.roster.map(r => r.playerId)).toEqual(['p-1', 'p-2'])
    expect(team.roster[1].gamesPlayed).toBe(0)
  })

  it('forces exact to false on a multi-court slot', () => {
    const multi = team.fixtures[0].slots.find(s => s.label === 'Pistas 3 y 4')!
    expect(multi.exact).toBe(false)
    expect(multi.courtCount).toBe(2)
  })

  it('produces the same fixtures the player profile does', () => {
    // Same input, same shaping — this is what proves the extraction did not
    // fork the uncertain-pairing rule into two copies that can drift.
    const profile = buildAmateurProfile('p-1', RAW)
    expect(team.fixtures).toEqual(profile.fixtures)
    expect(team.roster).toEqual(profile.roster)
  })
})

describe('fetchTeamSeason league scoping', () => {
  it('filters by both slug and source', async () => {
    // /snp/<x> must never serve a team from another league. The URL promises
    // the league, so the query has to honour it — asserting on the filters is
    // how we keep that promise under refactoring.
    const applied: Array<{ method: string; args: unknown[] }> = []
    const builder: Record<string, unknown> = {}
    const chain = (m: string) => (...args: unknown[]) => { applied.push({ method: m, args }); return builder }
    builder.select = chain('select')
    builder.eq = chain('eq')
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null })
    const client = { from: () => builder }

    const result = await fetchTeamSeason(client as never, 'blue-padel-mataro', 'snp')

    expect(result).toBeNull()
    const eqs = applied.filter(a => a.method === 'eq').map(a => a.args)
    expect(eqs).toContainEqual(['slug', 'blue-padel-mataro'])
    expect(eqs).toContainEqual(['source', 'snp'])
  })
})
