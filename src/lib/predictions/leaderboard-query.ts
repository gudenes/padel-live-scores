// src/lib/predictions/leaderboard-query.ts
//
// Pure logic for the leaderboard endpoint. Sorting + cursor encoding live
// here so the route handler is thin. The actual SQL/JOIN is built directly
// in the route using the supabase client; this module handles the
// cursor-comparable ordering and ranks.

export interface LeaderboardRowInput {
  userId: string
  name: string | null
  avatar: string | null
  picksCount: number
  accuracyPct: number
  guacas: number
  earliestPickAt: string  // ISO timestamp
}

export interface RankedLeaderboardRow extends LeaderboardRowInput {
  rank: number
}

export interface LeaderboardCursor {
  guacas: number
  accuracyPct: number
  picksCount: number
  earliestPickAt: string
  userId: string
}

export function encodeCursor(c: LeaderboardCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url')
}

export function decodeCursor(raw: string | null): LeaderboardCursor | null {
  if (!raw) return null
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    const obj = JSON.parse(json)
    if (
      typeof obj === 'object' && obj !== null &&
      typeof obj.guacas === 'number' &&
      typeof obj.accuracyPct === 'number' &&
      typeof obj.picksCount === 'number' &&
      typeof obj.earliestPickAt === 'string' &&
      typeof obj.userId === 'string'
    ) return obj as LeaderboardCursor
    return null
  } catch {
    return null
  }
}

/**
 * Sort rows by tie-break order and assign 1-based ranks.
 * Order: guacas DESC, accuracy DESC, picks DESC, earliestPickAt ASC, userId ASC.
 */
export function rankRows(rows: LeaderboardRowInput[]): RankedLeaderboardRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.guacas !== a.guacas) return b.guacas - a.guacas
    if (b.accuracyPct !== a.accuracyPct) return b.accuracyPct - a.accuracyPct
    if (b.picksCount !== a.picksCount) return b.picksCount - a.picksCount
    const da = new Date(a.earliestPickAt).getTime()
    const db = new Date(b.earliestPickAt).getTime()
    if (da !== db) return da - db
    return a.userId.localeCompare(b.userId)
  })
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }))
}
