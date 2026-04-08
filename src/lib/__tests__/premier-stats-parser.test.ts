// src/lib/__tests__/premier-stats-parser.test.ts

import { describe, it, expect } from 'vitest'
import { parseMatchStatsPayload, type MatchStatsRow } from '../premier-stats-parser'
import fixture6189 from '../__fixtures__/premier-match-6189.json'
import fixture2set from '../__fixtures__/premier-match-2set.json'

// The fixtures are stored as full API responses { status, data: {...} }
// The parser expects just the `data` object.
const payload6189 = (fixture6189 as { data: unknown }).data
const payload2set = (fixture2set as { data: unknown }).data

// ── Helpers to compute expected values from the raw fixture ────
// These avoid hard-coding magic numbers that could drift with fixture updates.

interface RawStatRow {
  title: string
  team_1: { title?: string | number; won?: string | number; played?: string | number }
  team_2: { title?: string | number; won?: string | number; played?: string | number }
}

interface RawSection {
  title: string
  service?: RawStatRow[]
  return?: RawStatRow[]
  total_points?: RawStatRow[]
}

function findRawSection(payload: unknown, sectionTitle: string): RawSection | null {
  const p = payload as { match_state?: RawSection[] } | null
  return p?.match_state?.find(s => s.title === sectionTitle) ?? null
}

function findRawStat(
  payload: unknown,
  sectionTitle: string,
  category: 'service' | 'return' | 'total_points',
  statTitle: string,
): RawStatRow | null {
  const section = findRawSection(payload, sectionTitle)
  return section?.[category]?.find(r => r.title === statTitle) ?? null
}

function num(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

// ── Tests ────────────────────────────────────────────────────

describe('parseMatchStatsPayload', () => {
  it('returns null when payload is null', () => {
    expect(parseMatchStatsPayload(null)).toBeNull()
  })

  it('returns null when payload is undefined', () => {
    expect(parseMatchStatsPayload(undefined)).toBeNull()
  })

  it('returns null when match_state is missing', () => {
    expect(parseMatchStatsPayload({} as never)).toBeNull()
  })

  it('returns null when match_state is empty', () => {
    expect(parseMatchStatsPayload({ match_state: [] } as never)).toBeNull()
  })

  it('parses the 3-set Miami P1 SF fixture into 4 rows', () => {
    const rows = parseMatchStatsPayload(payload6189 as never)
    expect(rows).not.toBeNull()
    expect(rows!.length).toBe(4)
    const setNumbers = rows!.map(r => r.set_number).sort()
    expect(setNumbers).toEqual([0, 1, 2, 3])
  })

  it('extracts service stats on the Match aggregate row matching the raw fixture', () => {
    const rows = parseMatchStatsPayload(payload6189 as never)
    const agg = rows!.find(r => r.set_number === 0)!
    const rawFirstServe = findRawStat(payload6189, 'Match', 'service', 'First Serve Points Won')
    expect(rawFirstServe).not.toBeNull()
    expect(agg.team1_first_serve_won).toBe(num(rawFirstServe!.team_1.won))
    expect(agg.team1_first_serve_played).toBe(num(rawFirstServe!.team_1.played))
    expect(agg.team2_first_serve_won).toBe(num(rawFirstServe!.team_2.won))
    expect(agg.team2_first_serve_played).toBe(num(rawFirstServe!.team_2.played))
  })

  it('extracts total_points on the Match aggregate row', () => {
    const rows = parseMatchStatsPayload(payload6189 as never)
    const agg = rows!.find(r => r.set_number === 0)!
    const rawTotal = findRawStat(payload6189, 'Match', 'total_points', 'Total Points Won')
    expect(rawTotal).not.toBeNull()
    expect(agg.team1_total_points_won).toBe(num(rawTotal!.team_1.won))
    expect(agg.team2_total_points_won).toBe(num(rawTotal!.team_2.won))
  })

  it('extracts longest_streak on the Match aggregate row', () => {
    const rows = parseMatchStatsPayload(payload6189 as never)
    const agg = rows!.find(r => r.set_number === 0)!
    const rawStreak = findRawStat(payload6189, 'Match', 'total_points', 'Longest Points Won Streak')
    expect(rawStreak).not.toBeNull()
    expect(agg.team1_longest_streak).toBe(num(rawStreak!.team_1.title))
    expect(agg.team2_longest_streak).toBe(num(rawStreak!.team_2.title))
  })

  it('sets total_points fields to null on per-set rows', () => {
    const rows = parseMatchStatsPayload(payload6189 as never)
    const set1 = rows!.find(r => r.set_number === 1)!
    expect(set1.team1_total_points_won).toBeNull()
    expect(set1.team2_total_points_won).toBeNull()
    expect(set1.team1_longest_streak).toBeNull()
    expect(set1.team2_longest_streak).toBeNull()
    expect(set1.team1_serve_points_won).toBeNull()
    expect(set1.team2_return_points_won).toBeNull()
  })

  it('populates service and return stats on per-set rows', () => {
    const rows = parseMatchStatsPayload(payload6189 as never)
    const set1 = rows!.find(r => r.set_number === 1)!
    expect(set1.team1_first_serve_won).not.toBeNull()
    expect(set1.team2_first_serve_won).not.toBeNull()
    expect(set1.team1_service_games).not.toBeNull()
  })

  it('parses a 2-set match into 3 rows (Match + set 1 + set 2)', () => {
    const rows = parseMatchStatsPayload(payload2set as never)
    expect(rows).not.toBeNull()
    expect(rows!.length).toBe(3)
    expect(rows!.map(r => r.set_number).sort()).toEqual([0, 1, 2])
  })

  it('coerces empty strings to null', () => {
    const payload = {
      match_state: [{
        title: 'Match',
        service: [{
          title: 'First Serve Points Won',
          team_1: { title: '', won: '', played: '', percentage: '', is_winner: 'No' },
          team_2: { title: '', won: '', played: '', percentage: '', is_winner: 'No' },
        }],
        return: [],
        total_points: [],
      }],
    }
    const rows = parseMatchStatsPayload(payload as never)
    expect(rows).not.toBeNull()
    expect(rows![0].team1_first_serve_won).toBeNull()
    expect(rows![0].team1_first_serve_played).toBeNull()
  })

  it('skips malformed sections with invalid titles', () => {
    const payload = {
      match_state: [
        { title: 'Match', service: [], return: [], total_points: [] },
        { title: 'garbage title', service: [], return: [] },
      ],
    }
    const rows = parseMatchStatsPayload(payload as never)
    expect(rows).not.toBeNull()
    expect(rows!.length).toBe(1)
    expect(rows![0].set_number).toBe(0)
  })
})
