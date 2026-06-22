// src/lib/player-entered-content.ts
// Pure builder for the personalized `player_entered` push. Given the players a
// single recipient follows that just entered a tournament, returns the
// per-user { title, body, icon, url }. Returns null when no named player is
// available so the caller can fall back to generic copy.

import { playerLastName } from './player-name'
import { resolveNotificationIcon } from './notification-icon'

export interface EnteredPlayer {
  id: string
  name: string | null
  display_name: string | null
  avatar_url: string | null
  ranking: number | null
}

export interface EnteredContent {
  title: string
  body: string
  icon: string
  url: string
}

export function buildPlayerEnteredContent(
  followed: EnteredPlayer[],
  tournament: { name: string | null; level: string | null },
): EnteredContent | null {
  const named = followed.filter((p) => p.display_name?.trim() || p.name)
  if (named.length === 0) return null

  // Headliner = best (lowest non-null) ranking; null sorts last; tie-break by
  // last name so the choice is deterministic across runs.
  const sorted = [...named].sort((a, b) => {
    const ra = a.ranking ?? Number.POSITIVE_INFINITY
    const rb = b.ranking ?? Number.POSITIVE_INFINITY
    if (ra !== rb) return ra - rb
    return playerLastName(a).localeCompare(playerLastName(b))
  })

  const headliner = sorted[0]
  const others = named.length - 1
  const tournamentName = tournament.name ?? 'an event'
  const name = playerLastName(headliner)

  const title =
    others > 0
      ? `${name} +${others} more entered ${tournamentName}`
      : `${name} entered ${tournamentName}`
  const body =
    others > 0 ? 'Players you follow joined the draw.' : 'Just added to the entry list.'
  const icon = resolveNotificationIcon({
    reason: 'follow',
    tournamentLevel: tournament.level ?? null,
    followedPlayerAvatarUrl: headliner.avatar_url ?? null,
  })

  return { title, body, icon, url: `/player/${headliner.id}` }
}
