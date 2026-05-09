import type { Match } from '@/types/match'

export type RoundCode = 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F'

export const ROUND_ORDER: RoundCode[] = ['R64', 'R32', 'R16', 'QF', 'SF', 'F']

/** Number of cells in each round, indexed by round code. */
export const ROUND_SLOTS: Record<RoundCode, number> = {
  R64: 32, R32: 16, R16: 8, QF: 4, SF: 2, F: 1,
}

export type BracketNode = {
  round: RoundCode
  positionInRound: number             // 0-based, top to bottom
  match: Match | null                 // null = upcoming/TBD slot or bye
  feedFromTop: BracketNode | null     // previous-round cell feeding top pair
  feedFromBottom: BracketNode | null  // previous-round cell feeding bottom pair
  isBye: boolean                      // true when this slot is a bye (one pair advances unopposed)
}

export type PairPath = {
  nodes: BracketNode[]            // every node where the pair appears, in round order
  eliminatedAt: RoundCode | null  // null if still active or won the tournament
}

export type DefendingChampPair = {
  player1Id: string
  player2Id: string
}

/** Stable pair identifier — order-independent, "smallerId::largerId". */
export function pairKeyFor(player1Id: string, player2Id: string): string {
  return player1Id < player2Id
    ? `${player1Id}::${player2Id}`
    : `${player2Id}::${player1Id}`
}
