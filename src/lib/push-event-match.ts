// Load the match row + follow map used to personalize event pushes.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PushMatch, PushPlayer } from '@/lib/push-copy'

type Supa = Pick<SupabaseClient, 'from'>

const PLAYER_SELECT = 'id, name, display_name, avatar_url'

function asPlayer(raw: unknown): PushPlayer | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as { id?: string; name?: string | null; display_name?: string | null; avatar_url?: string | null }
  if (!p.id) return null
  return {
    id: p.id,
    name: p.name ?? null,
    display_name: p.display_name ?? null,
    avatar_url: p.avatar_url ?? null,
  }
}

export async function loadPushMatch(supabase: Supa, matchId: string): Promise<PushMatch | null> {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, round, court, scheduled_at, category, winner_pair,
      tournament:tournaments(name, level, timezone),
      pair1_player1:players!matches_pair1_player1_id_fkey(${PLAYER_SELECT}),
      pair1_player2:players!matches_pair1_player2_id_fkey(${PLAYER_SELECT}),
      pair2_player1:players!matches_pair2_player1_id_fkey(${PLAYER_SELECT}),
      pair2_player2:players!matches_pair2_player2_id_fkey(${PLAYER_SELECT}),
      sets(set_number, set_score, pair1_games, pair2_games)
    `)
    .eq('id', matchId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as Record<string, unknown>
  const tournamentRaw = row.tournament as { name?: string | null; level?: string | null; timezone?: string | null } | null
  return {
    id: String(row.id),
    round: (row.round as string | null) ?? null,
    court: (row.court as string | null) ?? null,
    scheduled_at: (row.scheduled_at as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    winner_pair: (row.winner_pair as number | null) ?? null,
    tournament: tournamentRaw
      ? {
          name: tournamentRaw.name ?? null,
          level: tournamentRaw.level ?? null,
          timezone: tournamentRaw.timezone ?? null,
        }
      : null,
    pair1_player1: asPlayer(row.pair1_player1),
    pair1_player2: asPlayer(row.pair1_player2),
    pair2_player1: asPlayer(row.pair2_player1),
    pair2_player2: asPlayer(row.pair2_player2),
    sets: (row.sets as PushMatch['sets']) ?? [],
  }
}

/** First followed player among `playerIds` wins (same as /api/push/notify). */
export async function loadFollowedPlayerByUser(
  supabase: Supa,
  userIds: string[],
  playerIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (userIds.length === 0 || playerIds.length === 0) return out
  const { data, error } = await supabase
    .from('user_bookmarks')
    .select('user_id, target_id')
    .eq('bookmark_type', 'player')
    .in('user_id', userIds)
    .in('target_id', playerIds)
  if (error || !data) return out
  for (const row of data as Array<{ user_id: string; target_id: string }>) {
    if (!row.user_id || !row.target_id) continue
    if (out.has(row.user_id)) continue
    out.set(row.user_id, row.target_id)
  }
  return out
}

export function matchIdFromEvent(input: {
  entityType: string
  entityId: string
  url: string
  metadata: Record<string, unknown>
}): string | null {
  if (input.entityType === 'match' && input.entityId) return input.entityId
  const fromMeta = input.metadata.match_id
  if (typeof fromMeta === 'string' && fromMeta) return fromMeta
  const m = input.url.match(/^\/match\/([^/?#]+)/)
  return m?.[1] ?? null
}
