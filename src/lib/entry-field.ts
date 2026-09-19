// src/lib/entry-field.ts
//
// Pure helpers for the pre-draw "field" phase of the Entries tab. Before the
// main draw is published there is no bracket and no projection, so the only
// ordering signal is seed (for the seeded pairs) and combined team points
// (for everyone else). Kept free of React/Supabase so it can be unit-tested.

/** One pair on the entry list. Mirrors the columns `useEntryList` selects. */
export interface FieldEntry {
  seed: number | null
  marker: string | null
  category: 'men' | 'women'
  player1_id: string | null
  player1_name: string | null
  player1_country: string | null
  player2_id: string | null
  player2_name: string | null
  player2_country: string | null
  team_points: number | null
}

export interface PlayerHydration {
  avatar_url: string | null
  ranking: number | null
}

export interface FieldPartition {
  seeded: FieldEntry[]
  unseeded: FieldEntry[]
}

/** Seeded pairs by seed asc; unseeded by combined points desc, unranked last. */
export function partitionField(entries: FieldEntry[]): FieldPartition {
  const seeded = entries
    .filter((e) => e.seed != null)
    .sort((a, b) => (a.seed as number) - (b.seed as number))
  const unseeded = entries
    .filter((e) => e.seed == null)
    // -1 as sentinel is safe: FIP points are cumulative with 0 as the floor, so -1 can never
    // collide with a real value and reliably sinks unseeded pairs with null points to the bottom
    .sort((a, b) => (b.team_points ?? -1) - (a.team_points ?? -1))
  return { seeded, unseeded }
}

export function combinedPoints(entry: FieldEntry): number | null {
  return entry.team_points ?? null
}

/** The better (numerically lower) of the pair's two FIP rankings. */
export function bestRank(
  entry: FieldEntry,
  playerMap: Record<string, PlayerHydration>,
): number | null {
  const ranks = [entry.player1_id, entry.player2_id]
    .map((id) => (id ? playerMap[id]?.ranking ?? null : null))
    .filter((r): r is number => r != null)
  return ranks.length > 0 ? Math.min(...ranks) : null
}
