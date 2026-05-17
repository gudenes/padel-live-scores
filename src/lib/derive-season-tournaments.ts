import { resolveMatchRoles } from './match-roles'
import type { MatchRowForTitles } from './derive-titles'

export type BestRound = 'W' | 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'Q3' | 'Q2' | 'Q1'

/** Higher number = deeper run. */
const ROUND_DEPTH: Record<string, number> = {
  W: 10, F: 9, SF: 8, QF: 7, R16: 6, R32: 5, R64: 4, Q3: 3, Q2: 2, Q1: 1,
}

export interface TournamentSummary {
  tournament: {
    id: string
    name: string
    level: string | null
    country: string | null
    starts_at: string | null
    ends_at: string | null
  }
  bestRound: BestRound
  matchCount: number
  wins: number
  losses: number
  /** True when player won the final (bestRound === 'W'). */
  isTitle: boolean
  /** ISO of the player's latest match in this tournament. */
  latestMatchAt: string | null
}

function matchYear(m: MatchRowForTitles): number | null {
  const iso = m.finished_at ?? m.played_at ?? m.scheduled_at
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear()
}

export function deriveSeasonTournaments(
  matches: MatchRowForTitles[],
  playerId: string,
  year: number,
): TournamentSummary[] {
  type Acc = TournamentSummary & { _depth: number }
  const byT = new Map<string, Acc>()

  for (const m of matches) {
    if (!m.tournament?.id) continue
    if (matchYear(m) !== year) continue
    const tid = m.tournament.id
    const roles = resolveMatchRoles(m, playerId)
    const isFinalWon = m.round === 'F' && roles.won
    const round = (isFinalWon ? 'W' : (m.round ?? 'R64')) as BestRound
    const depth = ROUND_DEPTH[round] ?? 0
    const iso = m.finished_at ?? m.played_at ?? m.scheduled_at

    const existing = byT.get(tid)
    if (!existing) {
      byT.set(tid, {
        tournament: {
          id: tid,
          name: m.tournament.name,
          level: m.tournament.level ?? null,
          country: m.tournament.country ?? null,
          starts_at: m.tournament.starts_at ?? null,
          ends_at: m.tournament.ends_at ?? null,
        },
        bestRound: round,
        matchCount: 1,
        wins: roles.won ? 1 : 0,
        losses: roles.lost ? 1 : 0,
        isTitle: round === 'W',
        latestMatchAt: iso,
        _depth: depth,
      })
    } else {
      existing.matchCount += 1
      if (roles.won) existing.wins += 1
      if (roles.lost) existing.losses += 1
      if (depth > existing._depth) {
        existing.bestRound = round
        existing._depth = depth
        existing.isTitle = round === 'W'
      }
      if (iso && (!existing.latestMatchAt || iso > existing.latestMatchAt)) {
        existing.latestMatchAt = iso
      }
    }
  }

  return Array.from(byT.values())
    .map(({ _depth, ...rest }) => rest)
    .sort((a, b) => {
      if (a.latestMatchAt === null && b.latestMatchAt === null) return 0
      if (a.latestMatchAt === null) return 1
      if (b.latestMatchAt === null) return -1
      return b.latestMatchAt.localeCompare(a.latestMatchAt)
    })
}
