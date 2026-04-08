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
  // Implementation in Task 8 (TDD: write failing tests in Task 7 first)
  return null
}
