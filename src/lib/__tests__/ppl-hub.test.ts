import { describe, it, expect } from 'vitest'
import {
  levelToLeague, leagueToLevel, divisionLabel, eventCityFromSlug, sortStandings,
  PPL_LEVELS, type StandingsRow,
} from '../ppl-hub'

describe('division spelling', () => {
  it('converts the tier key to the league id', () => {
    // tournaments.level says ppl_ii; team_seasons.league says ppl-ii. Joining
    // one to the other unconverted returns zero rows and no error.
    expect(levelToLeague('ppl_ii')).toBe('ppl-ii')
    expect(levelToLeague('ppl')).toBe('ppl')
  })

  it('round-trips both divisions', () => {
    for (const lv of PPL_LEVELS) expect(leagueToLevel(levelToLeague(lv))).toBe(lv)
  })

  it('rejects a league id it does not know instead of guessing', () => {
    // A silent fallback to 'ppl' would put PPL III results in the PPL table.
    expect(leagueToLevel('ppl-iii')).toBeNull()
    expect(leagueToLevel('')).toBeNull()
  })

  it('never returns the underscore form as a league id', () => {
    expect(levelToLeague('ppl_ii')).not.toBe('ppl_ii')
  })

  it('labels the divisions', () => {
    expect(divisionLabel('ppl')).toBe('PPL')
    expect(divisionLabel('ppl_ii')).toBe('PPL II')
  })
})

describe('eventCityFromSlug', () => {
  it('reads the city off every slug in the 2026 season', () => {
    expect(eventCityFromSlug('new-york-2026')).toBe('New York')
    expect(eventCityFromSlug('new-york-ppl-ii-2026')).toBe('New York')
    expect(eventCityFromSlug('los-angeles-2026')).toBe('Los Angeles')
    expect(eventCityFromSlug('los-angeles-ppl-ii-2026')).toBe('Los Angeles')
    expect(eventCityFromSlug('playa-del-carmen-ppl-ii-2026')).toBe('Playa Del Carmen')
    expect(eventCityFromSlug('miami-2026')).toBe('Miami')
  })

  it('gives the SAME city for both divisions of one stop', () => {
    // The division is rendered as its own pill; repeating it in the title
    // would read "Los Angeles PPL II — PPL II".
    expect(eventCityFromSlug('los-angeles-ppl-ii-2026')).toBe(eventCityFromSlug('los-angeles-2026'))
  })

  it('returns null on a slug it cannot parse, so the caller can fall back', () => {
    expect(eventCityFromSlug(null)).toBeNull()
    expect(eventCityFromSlug('')).toBeNull()
    expect(eventCityFromSlug('2026')).toBeNull()
  })
})

describe('sortStandings', () => {
  const row = (name: string, w: number, cw: number, cl: number): StandingsRow => ({
    seasonId: name, teamId: name, teamName: name, crestUrl: null, brandColor: null,
    tiesPlayed: w + 2, tiesWon: w, courtsWon: cw, courtsLost: cl,
  })

  it('orders by ties won first', () => {
    expect(sortStandings([row('A', 1, 9, 0), row('B', 4, 1, 9)]).map(r => r.teamName))
      .toEqual(['B', 'A'])
  })

  it('breaks a tie on court difference, not on courts won', () => {
    // A: +3 from 5-2. B: +2 from 6-4. B won more courts but A is ahead.
    expect(sortStandings([row('B', 3, 6, 4), row('A', 3, 5, 2)]).map(r => r.teamName))
      .toEqual(['A', 'B'])
  })

  it('falls to courts won when the difference also ties', () => {
    expect(sortStandings([row('B', 3, 4, 3), row('A', 3, 6, 5)]).map(r => r.teamName))
      .toEqual(['A', 'B'])
  })

  it('is stable and alphabetical when records are identical', () => {
    // Without a final tiebreak two equal rows swap on every re-sort, which
    // reads as the table flickering.
    const input = [row('Toronto', 2, 4, 4), row('Miami', 2, 4, 4), row('Austin', 2, 4, 4)]
    expect(sortStandings(input).map(r => r.teamName)).toEqual(['Austin', 'Miami', 'Toronto'])
    expect(sortStandings(sortStandings(input)).map(r => r.teamName)).toEqual(['Austin', 'Miami', 'Toronto'])
  })

  it('does not mutate its input', () => {
    const input = [row('B', 1, 1, 1), row('A', 5, 5, 0)]
    sortStandings(input)
    expect(input.map(r => r.teamName)).toEqual(['B', 'A'])
  })
})
