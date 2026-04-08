// src/lib/premier-stats-parser.ts
//
// Pure function: PremierMatchDetail → MatchStatsRow[]
// Returns one row per section in match_state:
//   - set_number = 0 for the 'Match' aggregate
//   - set_number = 1..5 for individual sets
//
// The 'total_points' category only exists on the 'Match' section, so per-set
// rows have NULL for all total_* columns. The raw_payload is stored only on
// the set_number = 0 row to avoid duplication.

import type { PremierMatchDetail, PremierStatRow } from './premier-api'

export interface MatchStatsRow {
  set_number: number

  // Service stats
  team1_first_serve_won: number | null
  team1_first_serve_played: number | null
  team1_second_serve_won: number | null
  team1_second_serve_played: number | null
  team1_service_games: number | null
  team2_first_serve_won: number | null
  team2_first_serve_played: number | null
  team2_second_serve_won: number | null
  team2_second_serve_played: number | null
  team2_service_games: number | null

  // Return stats
  team1_first_return_won: number | null
  team1_first_return_played: number | null
  team1_second_return_won: number | null
  team1_second_return_played: number | null
  team1_return_games: number | null
  team2_first_return_won: number | null
  team2_first_return_played: number | null
  team2_second_return_won: number | null
  team2_second_return_played: number | null
  team2_return_games: number | null

  // Total points (null on per-set rows)
  team1_total_points_won: number | null
  team1_total_points_played: number | null
  team1_serve_points_won: number | null
  team1_serve_points_played: number | null
  team1_return_points_won: number | null
  team1_return_points_played: number | null
  team1_longest_streak: number | null
  team2_total_points_won: number | null
  team2_total_points_played: number | null
  team2_serve_points_won: number | null
  team2_serve_points_played: number | null
  team2_return_points_won: number | null
  team2_return_points_played: number | null
  team2_longest_streak: number | null
}

// Coerce Premier's mixed string/number/empty values to nullable numbers.
function num(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

// Find a named stat row inside a section category.
function findStat(
  rows: PremierStatRow[] | undefined,
  title: string,
): PremierStatRow | undefined {
  return rows?.find(s => s.title === title)
}

export function parseMatchStatsPayload(
  payload: PremierMatchDetail | null | undefined,
): MatchStatsRow[] | null {
  if (!payload) return null
  const sections = payload.match_state
  if (!Array.isArray(sections) || sections.length === 0) return null

  const rows: MatchStatsRow[] = []

  for (const section of sections) {
    // Parse set number from title: 'Match' → 0, 'set 1' → 1, etc.
    let setNumber: number
    if (section.title === 'Match') {
      setNumber = 0
    } else {
      const m = /^set\s+(\d+)$/i.exec(section.title ?? '')
      if (!m) continue  // Skip malformed section titles
      setNumber = parseInt(m[1], 10)
      if (!Number.isFinite(setNumber)) continue
    }

    const fs = findStat(section.service, 'First Serve Points Won')
    const ss = findStat(section.service, 'Second Serve Points Won')
    const sg = findStat(section.service, 'Services Games Played')
    const fr = findStat(section.return, 'First Return Points Won')
    const sr = findStat(section.return, 'Second Return Points Won')
    const rg = findStat(section.return, 'Return Games Played')
    // Total points only appear on the 'Match' section (set_number = 0)
    const tp = setNumber === 0 ? findStat(section.total_points, 'Total Points Won') : undefined
    const tsp = setNumber === 0 ? findStat(section.total_points, 'Total Serve Points Won') : undefined
    const trp = setNumber === 0 ? findStat(section.total_points, 'Total Return Points Won') : undefined
    const lps = setNumber === 0 ? findStat(section.total_points, 'Longest Points Won Streak') : undefined

    rows.push({
      set_number: setNumber,

      // Service
      team1_first_serve_won: num(fs?.team_1.won),
      team1_first_serve_played: num(fs?.team_1.played),
      team2_first_serve_won: num(fs?.team_2.won),
      team2_first_serve_played: num(fs?.team_2.played),
      team1_second_serve_won: num(ss?.team_1.won),
      team1_second_serve_played: num(ss?.team_1.played),
      team2_second_serve_won: num(ss?.team_2.won),
      team2_second_serve_played: num(ss?.team_2.played),
      team1_service_games: num(sg?.team_1.title),
      team2_service_games: num(sg?.team_2.title),

      // Return
      team1_first_return_won: num(fr?.team_1.won),
      team1_first_return_played: num(fr?.team_1.played),
      team2_first_return_won: num(fr?.team_2.won),
      team2_first_return_played: num(fr?.team_2.played),
      team1_second_return_won: num(sr?.team_1.won),
      team1_second_return_played: num(sr?.team_1.played),
      team2_second_return_won: num(sr?.team_2.won),
      team2_second_return_played: num(sr?.team_2.played),
      team1_return_games: num(rg?.team_1.title),
      team2_return_games: num(rg?.team_2.title),

      // Total points (null on per-set rows because tp/tsp/trp/lps are undefined there)
      team1_total_points_won: num(tp?.team_1.won),
      team1_total_points_played: num(tp?.team_1.played),
      team2_total_points_won: num(tp?.team_2.won),
      team2_total_points_played: num(tp?.team_2.played),
      team1_serve_points_won: num(tsp?.team_1.won),
      team1_serve_points_played: num(tsp?.team_1.played),
      team2_serve_points_won: num(tsp?.team_2.won),
      team2_serve_points_played: num(tsp?.team_2.played),
      team1_return_points_won: num(trp?.team_1.won),
      team1_return_points_played: num(trp?.team_1.played),
      team2_return_points_won: num(trp?.team_2.won),
      team2_return_points_played: num(trp?.team_2.played),
      team1_longest_streak: num(lps?.team_1.title),
      team2_longest_streak: num(lps?.team_2.title),
    })
  }

  return rows.length > 0 ? rows : null
}
