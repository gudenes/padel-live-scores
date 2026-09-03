// Latest-per-day snapshot rows for Tournament Explorer → Matches.
//
// results_snapshots / oop_snapshots are append-only (every scrape keeps
// every match). Selecting all rows for a live P1 times out. We only need
// the newest scrape_job per day_number.

import { pgPool } from './db'

export const SNAPSHOT_MATCH_TABLES = ['oop_snapshots', 'results_snapshots'] as const
export type SnapshotMatchTable = (typeof SNAPSHOT_MATCH_TABLES)[number]

const ALLOWED = new Set<string>(SNAPSHOT_MATCH_TABLES)

export function assertSnapshotMatchTable(table: string): asserts table is SnapshotMatchTable {
  if (!ALLOWED.has(table)) {
    throw new Error(`unknown snapshot match table: ${table}`)
  }
}

async function latestJobIds(table: SnapshotMatchTable, tournamentId: string): Promise<string[]> {
  assertSnapshotMatchTable(table)
  const { rows } = await pgPool().query<{ scrape_job_id: string }>(
    `
    SELECT s.scrape_job_id
    FROM generate_series(1, 20) AS d(day_number)
    LEFT JOIN LATERAL (
      SELECT scrape_job_id
      FROM padelgod.${table}
      WHERE tournament_id = $1 AND day_number = d.day_number
      ORDER BY captured_at DESC
      LIMIT 1
    ) s ON true
    WHERE s.scrape_job_id IS NOT NULL
    `,
    [tournamentId],
  )
  return [...new Set(rows.map((r) => r.scrape_job_id))]
}

function asIso(value: Date | string | null | undefined): string {
  if (!value) return ''
  return value instanceof Date ? value.toISOString() : String(value)
}

function asDayDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const s = String(value)
  return s.length >= 10 ? s.slice(0, 10) : s
}

export interface LatestOopSnapshotRow {
  scrape_job_id: string
  tournament_id: string
  day_number: number
  day_date: string | null
  category: 'men' | 'women'
  round_label: string | null
  court: string | null
  court_position: number | null
  scheduled_label: string | null
  team1_player1_name: string | null
  team1_player2_name: string | null
  team2_player1_name: string | null
  team2_player2_name: string | null
  match_widget_id: string | null
  status: string | null
  captured_at: string
}

export interface LatestResultsSnapshotRow {
  scrape_job_id: string
  tournament_id: string
  day_number: number
  category: 'men' | 'women'
  round_label: string | null
  court: string | null
  match_widget_id: string | null
  team1_player1_name: string | null
  team1_player2_name: string | null
  team2_player1_name: string | null
  team2_player2_name: string | null
  set_scores: unknown | null
  winner_team: number | null
  status: string | null
  captured_at: string
}

export async function fetchLatestOopSnapshots(tournamentId: string): Promise<LatestOopSnapshotRow[]> {
  const jobIds = await latestJobIds('oop_snapshots', tournamentId)
  if (jobIds.length === 0) return []
  const { rows } = await pgPool().query(
    `
    SELECT scrape_job_id, tournament_id, day_number, day_date, category, round_label,
           court, court_position, scheduled_label,
           team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name,
           match_widget_id, status, captured_at
    FROM padelgod.oop_snapshots
    WHERE tournament_id = $1 AND scrape_job_id = ANY($2::uuid[])
    `,
    [tournamentId, jobIds],
  )
  return rows.map((r) => ({
    ...r,
    day_date: asDayDate(r.day_date),
    captured_at: asIso(r.captured_at),
  })) as LatestOopSnapshotRow[]
}

export async function fetchLatestResultsSnapshots(tournamentId: string): Promise<LatestResultsSnapshotRow[]> {
  const jobIds = await latestJobIds('results_snapshots', tournamentId)
  if (jobIds.length === 0) return []
  const { rows } = await pgPool().query(
    `
    SELECT scrape_job_id, tournament_id, day_number, category, round_label, court,
           match_widget_id, team1_player1_name, team1_player2_name,
           team2_player1_name, team2_player2_name, set_scores, winner_team,
           status, captured_at
    FROM padelgod.results_snapshots
    WHERE tournament_id = $1 AND scrape_job_id = ANY($2::uuid[])
    `,
    [tournamentId, jobIds],
  )
  return rows.map((r) => ({
    ...r,
    captured_at: asIso(r.captured_at),
  })) as LatestResultsSnapshotRow[]
}
