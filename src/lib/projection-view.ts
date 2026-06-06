import type { Match, Player } from '@/types/match'
import type { ProjectionRow, ProjectionRoundJson, ProjRound } from '@/lib/projection-types'

export interface RoadPlayerVM {
  id: string
  name: string
  country: string | null
  avatarUrl: string | null
}

export interface RoadOpponentVM {
  pairKey: string
  players: RoadPlayerVM[]
  faceProb: number
  winProb: number
}

export interface RoadRoundVM {
  round: ProjRound
  dateIso: string | null
  reachProb: number
  expected: RoadOpponentVM | null
  opponents: RoadOpponentVM[]
}

export interface RoadVM {
  pairKey: string
  players: RoadPlayerVM[]
  championProb: number
  finalistProb: number
  semifinalProb: number
  rounds: RoadRoundVM[]
}

export const ROUND_LABEL_KEY: Record<ProjRound, string> = {
  R64: 'roundR64', R32: 'roundR32', R16: 'roundR16', QF: 'roundQF', SF: 'roundSF', F: 'roundF',
}

export function buildPlayerLookup(matches: Match[]): Map<string, Player> {
  const map = new Map<string, Player>()
  for (const m of matches) {
    for (const p of [m.pair1_player1, m.pair1_player2, m.pair2_player1, m.pair2_player2]) {
      if (p?.id && !map.has(p.id)) map.set(p.id, p)
    }
  }
  return map
}

export function roundDisoFor(
  round: ProjRound,
  schedule: Record<string, string> | null | undefined,
): string | null {
  if (!schedule) return null
  return schedule[round.toLowerCase()] ?? null
}

export function pickDefaultProjectionPair(
  rows: ProjectionRow[],
  bookmarkedPlayerIds: string[],
): string | null {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => b.champion_prob - a.champion_prob)
  const booked = new Set(bookmarkedPlayerIds)
  const withBookmark = sorted.find((r) => r.pair_player_ids.some((id) => booked.has(id)))
  return (withBookmark ?? sorted[0]).pair_key
}

function resolvePlayers(
  ids: string[],
  names: string[],
  lookup: Map<string, Player>,
): RoadPlayerVM[] {
  return ids.map((id, i) => {
    const p = lookup.get(id)
    return {
      id,
      name: p?.display_name ?? p?.name ?? names[i] ?? '',
      country: p?.country ?? null,
      avatarUrl: p?.avatar_url ?? null,
    }
  })
}

function opponentVM(
  o: ProjectionRoundJson['opponents'][number],
  lookup: Map<string, Player>,
): RoadOpponentVM {
  return {
    pairKey: o.pair_key,
    players: resolvePlayers(o.player_ids, o.names, lookup),
    faceProb: o.reach_prob,
    winProb: o.win_prob,
  }
}

export function buildRoadVM(
  row: ProjectionRow,
  lookup: Map<string, Player>,
  schedule: Record<string, string> | null | undefined,
): RoadVM {
  return {
    pairKey: row.pair_key,
    players: resolvePlayers(row.pair_player_ids, row.pair_player_ids, lookup),
    championProb: row.champion_prob,
    finalistProb: row.finalist_prob,
    semifinalProb: row.semifinal_prob,
    rounds: row.rounds.map((r) => {
      const opponents = r.opponents
        .map((o) => opponentVM(o, lookup))
        .sort((a, b) => b.faceProb - a.faceProb)
      const expected = opponents[0] ?? null
      return { round: r.round, dateIso: roundDisoFor(r.round, schedule), reachProb: r.reach_prob, expected, opponents }
    }),
  }
}
