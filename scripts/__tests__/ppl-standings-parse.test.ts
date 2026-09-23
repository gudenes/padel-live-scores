import { describe, it, expect } from 'vitest'
import {
  parseStandingsTable, parseIntCell, parsePercentCell, parseRecordCell,
  checkPointsIdentity, type RawStandingsTable, type ParsedStandingsRow,
} from '../lib/ppl-standings-parse'

// Captured 2026-09-23 from propadelleague.com/league/standings.
// The two shapes are the point of these fixtures: the overall table carries
// Men's / Women's RECORD columns where the gendered tables carry Wins /
// Losses COUNTS, in the same ordinal position.

const OVERALL: RawStandingsTable = {
  headers: ['rank', 'team', 'points', 'matches played', "men's", "women's",
    '%matches won', '%sets won', '%games won', '%points won'],
  rows: [
    { slug: 'dc-matrix', cells: {
      rank: '1', team: 'DC Matrix', points: '71', 'matches played': '8',
      "men's": '3-1', "women's": '3-1',
      '%matches won': '75%', '%sets won': '72%', '%games won': '59%', '%points won': '54%' } },
    { slug: 'las-vegas-smash', cells: {
      rank: '10', team: 'Las Vegas Smash', points: '11', 'matches played': '8',
      "men's": '0-4', "women's": '2-2',
      '%matches won': '25%', '%sets won': '24%', '%games won': '39%', '%points won': '44%' } },
  ],
}

const MENS: RawStandingsTable = {
  headers: ['rank', 'team', 'points', 'matches played', 'wins', 'losses',
    '%matches won', '%sets won', '%games won', '%points won'],
  rows: [
    { slug: 'dc-matrix', cells: {
      rank: '1', team: 'DC Matrix', points: '37', 'matches played': '4',
      wins: '3', losses: '1',
      '%matches won': '75%', '%sets won': '78%', '%games won': '64%', '%points won': '56%' } },
    { slug: 'houston-volts', cells: {
      rank: '9', team: 'Houston Volts', points: '2', 'matches played': '4',
      wins: '2', losses: '2',
      '%matches won': '50%', '%sets won': '50%', '%games won': '49%', '%points won': '51%' } },
  ],
}

describe('cell parsers', () => {
  it('reads integers and rejects anything else', () => {
    expect(parseIntCell('37')).toBe(37)
    expect(parseIntCell(' 0 ')).toBe(0)
    expect(parseIntCell('3-1')).toBeNull()
    expect(parseIntCell('75%')).toBeNull()
    expect(parseIntCell('')).toBeNull()
    expect(parseIntCell(null)).toBeNull()
  })

  it('reads a percent as the PERCENT, not a fraction', () => {
    // Returning 0.75 here would invite a second conversion at render and put
    // "0.75%" on screen.
    expect(parsePercentCell('75%')).toBe(75)
    expect(parsePercentCell('100%')).toBe(100)
    expect(parsePercentCell('0%')).toBe(0)
  })

  it('does not read a bare number as a percent', () => {
    expect(parsePercentCell('75')).toBeNull()
  })

  it('reads a W-L record', () => {
    expect(parseRecordCell('3-1')).toEqual({ wins: 3, losses: 1 })
    expect(parseRecordCell('0-4')).toEqual({ wins: 0, losses: 4 })
    expect(parseRecordCell('4')).toBeNull()
  })
})

describe('parseStandingsTable — gendered shape', () => {
  it('reads every column of a real row', () => {
    const [dc] = parseStandingsTable(MENS)
    expect(dc).toEqual<ParsedStandingsRow>({
      slug: 'dc-matrix', rank: 1, points: 37, matchesPlayed: 4,
      wins: 3, losses: 1,
      pctMatches: 75, pctSets: 78, pctGames: 64, pctPoints: 56,
    })
  })

  it('keeps points independent of the record', () => {
    // Houston is 2-2 on 2 points; Los Angeles is also 2-2 but on 10. Points
    // are NOT a function of W/L, which is why they are scraped at all.
    const rows = parseStandingsTable(MENS)
    expect(rows.find(r => r.slug === 'houston-volts')!.points).toBe(2)
    expect(rows.find(r => r.slug === 'houston-volts')!.wins).toBe(2)
  })
})

describe('parseStandingsTable — overall shape', () => {
  it('sums the two gendered records into one W/L', () => {
    // Column 4 here is "3-1", not a win count. Reading by position instead
    // of by header would store wins=3 and losses=1 for a team that is 6-2.
    const [dc] = parseStandingsTable(OVERALL)
    expect(dc.wins).toBe(6)
    expect(dc.losses).toBe(2)
  })

  it('handles a lopsided split', () => {
    const lv = parseStandingsTable(OVERALL).find(r => r.slug === 'las-vegas-smash')!
    expect(lv.wins).toBe(2)   // 0 men's + 2 women's
    expect(lv.losses).toBe(6) // 4 men's + 2 women's
  })

  it('reads the same non-record columns identically in both shapes', () => {
    const o = parseStandingsTable(OVERALL)[0]
    const m = parseStandingsTable(MENS)[0]
    expect(o.slug).toBe(m.slug)
    expect(o.rank).toBe(1)
    expect(o.points).toBe(71)
    expect(m.points).toBe(37)
  })
})

describe('parseStandingsTable — robustness', () => {
  it('skips a row with no team link rather than emitting a slugless row', () => {
    const t: RawStandingsTable = { headers: OVERALL.headers, rows: [{ slug: null, cells: { rank: '1' } }] }
    expect(parseStandingsTable(t)).toEqual([])
  })

  it('takes the leading integer from a rank cell carrying podium annotations', () => {
    // Per-event tables render "1 / GS 1 / 1ST" inside the rank cell.
    const t: RawStandingsTable = {
      headers: MENS.headers,
      rows: [{ slug: 'x', cells: { rank: '1\nGS 1\n1ST', points: '8' } }],
    }
    expect(parseStandingsTable(t)[0].rank).toBe(1)
  })

  it('nulls an unknown column instead of borrowing a neighbour', () => {
    // If upstream renames a header, the field must go null. Falling back to
    // an adjacent column would put %sets into %games and look plausible.
    const t: RawStandingsTable = {
      headers: ['rank', 'team', 'points'],
      rows: [{ slug: 'x', cells: { rank: '1', points: '9' } }],
    }
    const [r] = parseStandingsTable(t)
    expect(r.points).toBe(9)
    expect(r.pctSets).toBeNull()
    expect(r.matchesPlayed).toBeNull()
    expect(r.wins).toBeNull()
  })

  it('tolerates header case and spacing drift', () => {
    const t: RawStandingsTable = {
      headers: [], rows: [{ slug: 'x', cells: { '  RANK  ': '2', 'Points': '5', '%Sets  Won': '61%' } }],
    }
    const [r] = parseStandingsTable(t)
    expect(r.rank).toBe(2)
    expect(r.points).toBe(5)
    expect(r.pctSets).toBe(61)
  })
})

describe('checkPointsIdentity', () => {
  const row = (slug: string, points: number | null): ParsedStandingsRow => ({
    slug, rank: null, points, matchesPlayed: null, wins: null, losses: null,
    pctMatches: null, pctSets: null, pctGames: null, pctPoints: null,
  })

  it('accepts upstream\'s own arithmetic', () => {
    // DC Matrix: 37 men's + 34 women's = 71 overall, as published.
    expect(checkPointsIdentity([row('dc', 71)], [row('dc', 37)], [row('dc', 34)])).toEqual([])
  })

  it('flags a franchise whose parts do not sum to its whole', () => {
    const bad = checkPointsIdentity([row('dc', 71)], [row('dc', 37)], [row('dc', 30)])
    expect(bad).toEqual([{ slug: 'dc', overall: 71, sum: 67 }])
  })

  it('flags a team missing from a gendered table, rather than passing it', () => {
    // A silent zero-fill would hide a scrape that captured only one scope.
    expect(checkPointsIdentity([row('dc', 71)], [row('dc', 37)], [])).toEqual([
      { slug: 'dc', overall: 71, sum: 37 },
    ])
  })

  it('ignores a row with no overall points to compare', () => {
    expect(checkPointsIdentity([row('dc', null)], [row('dc', 37)], [row('dc', 34)])).toEqual([])
  })
})
