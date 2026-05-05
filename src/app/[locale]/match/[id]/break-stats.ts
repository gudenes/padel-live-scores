import type { Match, Set as MatchSet } from '@/types/match'

export interface BreakAggregate {
  team1: number
  team2: number
}

export interface BreakStats {
  match: BreakAggregate
  perSet: Record<number, BreakAggregate>
  hasData: boolean
}

function aggregateGames(
  games: MatchSet['games'],
  pair1Ids: Set<string>,
  pair2Ids: Set<string>,
  out: BreakAggregate,
): boolean {
  let any = false
  for (const g of games ?? []) {
    const winner = g.winner_pair === 1 || g.winner_pair === 2 ? g.winner_pair : null
    const sid = g.server_player_id
    let serverPair: 1 | 2 | null = null
    if (sid && pair1Ids.has(sid)) serverPair = 1
    else if (sid && pair2Ids.has(sid)) serverPair = 2
    if (winner !== null && serverPair !== null) {
      any = true
      if (serverPair !== winner) {
        if (winner === 1) out.team1 += 1
        else out.team2 += 1
      }
    }
  }
  return any
}

export function computeBreaks(match: Match): BreakStats {
  const pair1Ids = new Set(
    [match.pair1_player1?.id, match.pair1_player2?.id].filter((x): x is string => !!x),
  )
  const pair2Ids = new Set(
    [match.pair2_player1?.id, match.pair2_player2?.id].filter((x): x is string => !!x),
  )

  const result: BreakStats = {
    match: { team1: 0, team2: 0 },
    perSet: {},
    hasData: false,
  }

  for (const s of match.sets ?? []) {
    const setAgg: BreakAggregate = { team1: 0, team2: 0 }
    const any = aggregateGames(s.games, pair1Ids, pair2Ids, setAgg)
    if (any) {
      result.hasData = true
      result.perSet[s.set_number] = setAgg
      result.match.team1 += setAgg.team1
      result.match.team2 += setAgg.team2
    }
  }

  return result
}
