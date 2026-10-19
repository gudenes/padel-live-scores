import type { SupabaseClient } from '@supabase/supabase-js'
import { previousIsoYearWeek } from './points-move'

const PROFILE_COLUMNS = 'id, name, display_name, country, avatar_url, category, updated_at'

/** Membership and scores come from one FIP publication, never legacy player ranks. */
export async function loadOfficialLeaderboard(
  snapshots: SupabaseClient,
  publicPlayers: SupabaseClient,
  gender: 'men' | 'women',
) {
  const latest = await snapshots.from('player_ranking_snapshots')
    .select('year, week, ranking_date').eq('type', 'official').eq('gender', gender)
    .order('ranking_date', { ascending: false }).limit(1).maybeSingle()
  if (latest.error) throw latest.error
  if (!latest.data) return { players: [], rankingDate: null }

  const { year, week, ranking_date: rankingDate } = latest.data
  const previous = previousIsoYearWeek(year, week)
  const [current, prior] = await Promise.all([
    snapshots.from('player_ranking_snapshots')
      .select('player_id, ranking, points, ranking_move')
      .eq('type', 'official').eq('gender', gender).eq('year', year).eq('week', week)
      .order('ranking').order('player_id').limit(1000),
    snapshots.from('player_ranking_snapshots').select('player_id, points')
      .eq('type', 'official').eq('gender', gender)
      .eq('year', previous.year).eq('week', previous.week).limit(1000),
  ])
  if (current.error) throw current.error
  if (prior.error) throw prior.error
  const rows = current.data ?? []
  const oldPoints = new Map((prior.data ?? []).map(row => [row.player_id, row.points]))

  // Read profiles through the public client so visibility policies still apply.
  // Chunk IDs to keep PostgREST URLs below proxy limits.
  const profiles = new Map<string, Record<string, unknown>>()
  for (let offset = 0; offset < rows.length; offset += 100) {
    const result = await publicPlayers.from('players').select(PROFILE_COLUMNS)
      .in('id', rows.slice(offset, offset + 100).map(row => row.player_id))
      .eq('hidden', false)
    if (result.error) throw result.error
    for (const player of result.data ?? []) profiles.set(player.id, player)
  }
  return {
    rankingDate,
    players: rows.filter(row => profiles.has(row.player_id)).map(row => {
      const previousPoints = oldPoints.get(row.player_id)
      return {
        ...profiles.get(row.player_id),
        ranking: row.ranking,
        points: row.points,
        ranking_move: row.ranking_move,
        points_move: row.points != null && previousPoints != null ? row.points - previousPoints : null,
        ranking_date: rankingDate,
      }
    }),
  }
}
