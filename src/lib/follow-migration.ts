// Computes the set of (bookmark_type, target_id) pairs that exist in
// the user's localStorage follow store but are absent from the DB.
// Used during sign-in to migrate anonymous follows into user_bookmarks.
//
// news_sources are never migrated — they're a localStorage-only feature.

export interface LocalFollowStore {
  matches: string[]
  players: string[]
  tournaments: string[]
  news_sources: string[]
}

export interface DbBookmarkRow {
  bookmark_type: string
  target_id: string
}

export interface MigrationItem {
  bookmark_type: 'match' | 'player' | 'tournament'
  target_id: string
}

export function computeFollowMigration(
  local: LocalFollowStore,
  dbRows: readonly DbBookmarkRow[],
): MigrationItem[] {
  const dbKey = (t: string, id: string) => `${t}::${id}`
  const dbSet = new Set(dbRows.map(r => dbKey(r.bookmark_type, r.target_id)))

  const out: MigrationItem[] = []
  for (const id of local.matches) {
    if (!dbSet.has(dbKey('match', id))) out.push({ bookmark_type: 'match', target_id: id })
  }
  for (const id of local.players) {
    if (!dbSet.has(dbKey('player', id))) out.push({ bookmark_type: 'player', target_id: id })
  }
  for (const id of local.tournaments) {
    if (!dbSet.has(dbKey('tournament', id))) out.push({ bookmark_type: 'tournament', target_id: id })
  }
  return out
}
