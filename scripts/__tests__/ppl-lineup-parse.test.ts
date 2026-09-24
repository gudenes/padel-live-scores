import { describe, it, expect } from 'vitest'
import {
  parseLineups, stripLineupNickname, alignLineupToTie, type RawLineupCourt,
} from '../lib/ppl-lineup-parse'

// Captured 2026-09-24 from the Playa del Carmen schedule page, day 1.
// Both oddities below are real rows from that capture, not invented cases.

const court = (over: Partial<RawLineupCourt> = {}): RawLineupCourt => ({
  stage: 'GROUP STAGE',
  label: 'MATCHUP #1',
  gender: "Women's",
  sides: [
    { rank: '#6', team: 'NEW YORK ATLANTICS', players: ['MARTA TALAVAN', 'SOFIA SAIZ VALLEJO'] },
    { rank: '#9', team: 'MEXICO WAVES', players: ['LUCIA PERALTA', 'PATRICIA MARTINEZ FORTUN'] },
  ],
  ...over,
})

describe('stripLineupNickname', () => {
  it('removes a quoted nickname', () => {
    // Real row: LEONEL "TOLITO" AGUIRRE. The resolver is keyed on the plain
    // name, so the nickname has to come out or the player never matches.
    expect(stripLineupNickname('LEONEL "TOLITO" AGUIRRE')).toBe('LEONEL AGUIRRE')
  })

  it('handles curly quotes too', () => {
    expect(stripLineupNickname('LEONEL “TOLITO” AGUIRRE')).toBe('LEONEL AGUIRRE')
  })

  it('leaves an ordinary name alone', () => {
    expect(stripLineupNickname('MAXIMILIANO ARCE')).toBe('MAXIMILIANO ARCE')
  })

  it('collapses the gap the removal leaves behind', () => {
    expect(stripLineupNickname('A "X" B')).not.toContain('  ')
  })
})

describe('parseLineups', () => {
  it('reads a normal court, both sides', () => {
    const { parsed, problems } = parseLineups([court()])
    expect(problems).toEqual([])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].category).toBe('women')
    expect(parsed[0].home).toEqual({
      team: 'NEW YORK ATLANTICS',
      players: ['MARTA TALAVAN', 'SOFIA SAIZ VALLEJO'],
    })
    expect(parsed[0].away.team).toBe('MEXICO WAVES')
  })

  it("maps Men's and Women's to our category values", () => {
    expect(parseLineups([court({ gender: "Men's" })]).parsed[0].category).toBe('men')
    expect(parseLineups([court({ gender: "Women's" })]).parsed[0].category).toBe('women')
  })

  it('REFUSES a side with three players rather than taking the first two', () => {
    // Real row: San Diego Stingrays listed three men on day 1. Nothing on the
    // page says which two start. Guessing would write an unverifiable pairing
    // into a player's permanent history.
    const { parsed, problems } = parseLineups([court({
      gender: "Men's",
      sides: [
        { rank: '#6', team: 'LOS ANGELES BEAT', players: ['DENIS TOMAS PERINO', 'LEONEL AGUIRRE'] },
        { rank: '#7', team: 'SAN DIEGO STINGRAYS', players: ['JOSE DAVID SANCHEZ SERRANO', 'JOSE JIMENEZ CASAS', 'MATIAS SEGURA'] },
      ],
    })])
    expect(parsed).toHaveLength(0)
    expect(problems).toHaveLength(1)
    expect(problems[0].reason).toBe('not-a-pair')
    expect(problems[0].detail).toContain('SAN DIEGO STINGRAYS')
    expect(problems[0].detail).toContain('3 named')
  })

  it('refuses a side with only one player', () => {
    const { parsed, problems } = parseLineups([court({
      sides: [
        { rank: '#6', team: 'A', players: ['ONE ONLY'] },
        { rank: '#9', team: 'B', players: ['X Y', 'Z W'] },
      ],
    })])
    expect(parsed).toHaveLength(0)
    expect(problems[0].reason).toBe('not-a-pair')
  })

  it('refuses a court that does not have exactly two sides', () => {
    // One side is the signature of iterating .cc-live-match__row instead of
    // .cc-live-match__team — a scrape that looks fine and loses every away
    // pairing. It must fail loudly, not half-succeed.
    const { problems } = parseLineups([court({ sides: [court().sides[0]] })])
    expect(problems[0].reason).toBe('wrong-side-count')
    expect(problems[0].detail).toContain('1 side')
  })

  it('refuses an unrecognised gender instead of defaulting to men', () => {
    const { parsed, problems } = parseLineups([court({ gender: 'Mixed' })])
    expect(parsed).toHaveLength(0)
    expect(problems[0].reason).toBe('unknown-gender')
  })

  it('keeps the nickname VERBATIM — stripping it breaks the lookup', () => {
    // Measured: upstream's player registry stores `Leonel "Tolito" Aguirre`,
    // and so does our players row. Stripping to `LEONEL AGUIRRE` made him
    // unresolvable. The resolver normalises punctuation away instead.
    const { parsed } = parseLineups([court({
      sides: [
        { rank: '#6', team: 'A', players: ['LEONEL "TOLITO" AGUIRRE', 'B B'] },
        { rank: '#9', team: 'B', players: ['C C', 'D D'] },
      ],
    })])
    expect(parsed[0].home.players[0]).toBe('LEONEL "TOLITO" AGUIRRE')
  })

  it('keeps good courts when a sibling is rejected', () => {
    // A bad row must not cost the whole day's line-ups.
    const bad = court({
      label: 'MATCHUP #2',
      sides: [court().sides[0], { rank: '#3', team: 'C', players: ['A A', 'B B', 'C C'] }],
    })
    const { parsed, problems } = parseLineups([court(), bad])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].label).toBe('MATCHUP #1')
    expect(problems).toHaveLength(1)
  })

  it('returns empty for empty input', () => {
    expect(parseLineups([])).toEqual({ parsed: [], problems: [] })
  })
})

describe('alignLineupToTie', () => {
  const parsed = parseLineups([court()]).parsed[0]

  it('keeps the order when upstream agrees with our tie', () => {
    const a = alignLineupToTie(parsed, 'NEW YORK ATLANTICS', 'MEXICO WAVES')!
    expect(a.flipped).toBe(false)
    expect(a.homePlayers).toEqual(['MARTA TALAVAN', 'SOFIA SAIZ VALLEJO'])
    expect(a.awayPlayers).toEqual(['LUCIA PERALTA', 'PATRICIA MARTINEZ FORTUN'])
  })

  it('SWAPS when our tie stored the franchises the other way round', () => {
    // pair1_* means the tie's home. If upstream lists the away side first and
    // nobody re-orients, every player lands on the opposing franchise.
    const a = alignLineupToTie(parsed, 'MEXICO WAVES', 'NEW YORK ATLANTICS')!
    expect(a.flipped).toBe(true)
    expect(a.homePlayers).toEqual(['LUCIA PERALTA', 'PATRICIA MARTINEZ FORTUN'])
    expect(a.awayPlayers).toEqual(['MARTA TALAVAN', 'SOFIA SAIZ VALLEJO'])
  })

  it('tolerates case and spacing differences in the franchise name', () => {
    // Upstream shouts its team names; ours are title-case in `teams.name`.
    expect(alignLineupToTie(parsed, 'New York Atlantics', 'Mexico  Waves')).not.toBeNull()
  })

  it('returns null when the franchises do not match, rather than assuming order', () => {
    // A positional fallback here would attach a whole pairing to a franchise
    // that never played the match.
    expect(alignLineupToTie(parsed, 'TORONTO POLAR BEARS', 'MIAMI PADEL CLUB')).toBeNull()
  })

  it('returns null when only one side matches', () => {
    expect(alignLineupToTie(parsed, 'NEW YORK ATLANTICS', 'TORONTO POLAR BEARS')).toBeNull()
  })
})
