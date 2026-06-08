// src/lib/notify-recipients.ts
// Resolve "followers of entity X" for event-driven notifications.
// player/tournament events fan out to user_bookmarks rows of the matching type.
// (match-scoped events keep using the dedicated logic in /api/push/notify.)

import type { SupabaseClient } from '@supabase/supabase-js'

export type EntityType = 'player' | 'tournament'

export type EntityFollowers = {
  userIds: string[]
}

// Bookmark type per entity. Only player/tournament are supported here.
const BOOKMARK_TYPE: Record<EntityType, string> = {
  player: 'player',
  tournament: 'tournament',
}

export async function resolveEntityFollowers(
  supabase: Pick<SupabaseClient, 'from'>,
  entityType: EntityType,
  entityId: string,
): Promise<EntityFollowers> {
  const bookmarkType = BOOKMARK_TYPE[entityType]
  if (!bookmarkType) return { userIds: [] }

  const { data, error } = await supabase
    .from('user_bookmarks')
    .select('user_id')
    .eq('bookmark_type', bookmarkType)
    .eq('target_id', entityId)

  if (error || !data) return { userIds: [] }
  const userIds = Array.from(new Set((data as { user_id: string }[]).map((r) => r.user_id)))
  return { userIds }
}
