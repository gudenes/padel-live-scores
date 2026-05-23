import { resolveMatchRoles, type MatchPlayer } from './match-roles'

export interface MatchRowForTitles {
  id: string
  round: string | null
  status: string
  winner_pair: number | null
  finished_at: string | null
  scheduled_at: string | null
  played_at?: string | null
  category?: string | null
  duration?: number | null
  pair1_player1?: MatchPlayer | null
  pair1_player2?: MatchPlayer | null
  pair2_player1?: MatchPlayer | null
  pair2_player2?: MatchPlayer | null
  tournament?: {
    id: string
    name: string | null
    level?: string | null
    country?: string | null
    starts_at?: string | null
    ends_at?: string | null
  } | null
}

export interface TitleEntry {
  tournamentId: string
  tournamentName: string
  tournamentLevel: string | null
  partner: MatchPlayer | null
  /** ISO date of the title-winning final */
  wonAt: string | null
}

/**
 * Returns the player's tournament wins, derived from final matches they won.
 * Sorted by `wonAt` descending. Duplicates by `tournament_id` are dropped.
 */
export function deriveTitles(
  matches: MatchRowForTitles[],
  playerId: string,
): TitleEntry[] {
  const entries: TitleEntry[] = []
  const seen = new Set<string>()
  for (const m of matches) {
    if (m.round !== 'F') continue
    if (!m.tournament?.id) continue
    if (seen.has(m.tournament.id)) continue
    const roles = resolveMatchRoles(m, playerId)
    if (!roles.won) continue
    entries.push({
      tournamentId: m.tournament.id,
      tournamentName: m.tournament.name ?? '',
      tournamentLevel: m.tournament.level ?? null,
      partner: roles.partner,
      wonAt: m.finished_at ?? m.played_at ?? m.scheduled_at,
    })
    seen.add(m.tournament.id)
  }
  return entries.sort((a, b) => {
    if (a.wonAt === null && b.wonAt === null) return 0
    if (a.wonAt === null) return 1   // null goes last
    if (b.wonAt === null) return -1
    return b.wonAt.localeCompare(a.wonAt)
  })
}
