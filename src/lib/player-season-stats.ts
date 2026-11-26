import type { SupabaseClient } from '@supabase/supabase-js'

export type SeasonStats = { wins: number; matches: number; winRate: number | null }
export type SeasonResult = {
  id: string
  status: string
  winner_pair: number | null
  scheduled_at: string | null
  started_at: string | null
  tournament: { starts_at: string | null } | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
}

export function calculateSeasonStats(rows: SeasonResult[], playerIds: string[], year: number) {
  const stats: Record<string, SeasonStats> = Object.fromEntries(
    playerIds.map(id => [id, { wins: 0, matches: 0, winRate: null }]),
  )
  const seen = new Set<string>()
  for (const row of rows) {
    const date = row.scheduled_at ?? row.started_at ?? row.tournament?.starts_at
    if (!date || new Date(date).getUTCFullYear() !== year || seen.has(row.id)) continue
    if (!['finished', 'retired'].includes(row.status) || ![1, 2].includes(row.winner_pair ?? 0)) continue
    seen.add(row.id)
    const pairs = [[row.pair1_player1_id, row.pair1_player2_id], [row.pair2_player1_id, row.pair2_player2_id]]
    for (const [id, stat] of Object.entries(stats)) {
      const pair = pairs.findIndex(players => players.includes(id)) + 1
      if (!pair) continue
      stat.matches++
      if (row.winner_pair === pair) stat.wins++
    }
  }
  for (const stat of Object.values(stats)) {
    stat.winRate = stat.matches ? Math.round(100 * stat.wins / stat.matches) : null
  }
  return stats
}

/** Indexed lookup of materialized totals: never scan match history on reads. */
export async function fetchPlayerSeasonStats(client: SupabaseClient, ids: string[], year: number, signal: AbortSignal) {
  const playerIds = [...new Set(ids.filter(id => /^[0-9a-f-]{36}$/i.test(id)))]
  if (!playerIds.length) return {}
  const { data, error } = await client.from('player_season_stats')
    .select('player_id,wins,matches,win_rate').eq('season', year).in('player_id', playerIds).abortSignal(signal)
  if (error) throw error
  const stats: Record<string, SeasonStats> = Object.fromEntries(playerIds.map(id => [id, { wins: 0, matches: 0, winRate: null }]))
  for (const row of data ?? []) stats[row.player_id] = { wins: row.wins, matches: row.matches, winRate: row.win_rate }
  return stats
}
