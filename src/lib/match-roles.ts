/**
 * resolveMatchRoles — given a match row and a player id, return that player's
 * role in the match: which pair they were on, partner, opponents, win/loss.
 *
 * Pure function. Safe for both UI and pure-function tests.
 *
 * Generic over the player type `P` so callers with richer player shapes (e.g.
 * a local `PartnerInfo`) get the same concrete type back in the return value
 * instead of the base `MatchPlayer`.
 */
export interface MatchPlayer {
  id: string
  name?: string | null
  display_name?: string | null
  country?: string | null
}

export interface MatchRowForRoles<P extends MatchPlayer = MatchPlayer> {
  pair1_player1?: P | null
  pair1_player2?: P | null
  pair2_player1?: P | null
  pair2_player2?: P | null
  status?: string | null
  winner_pair?: number | null
}

export interface ResolvedMatchRoles<P extends MatchPlayer = MatchPlayer> {
  isP1: boolean
  partner: P | null
  opp1: P | null
  opp2: P | null
  myPair: 1 | 2
  won: boolean
  lost: boolean
}

export function resolveMatchRoles<P extends MatchPlayer>(
  match: MatchRowForRoles<P>,
  playerId: string,
): ResolvedMatchRoles<P> {
  const isP1 =
    match.pair1_player1?.id === playerId || match.pair1_player2?.id === playerId
  const partner = isP1
    ? (match.pair1_player1?.id === playerId ? match.pair1_player2 : match.pair1_player1) ?? null
    : (match.pair2_player1?.id === playerId ? match.pair2_player2 : match.pair2_player1) ?? null
  const opp1 = (isP1 ? match.pair2_player1 : match.pair1_player1) ?? null
  const opp2 = (isP1 ? match.pair2_player2 : match.pair1_player2) ?? null
  const myPair: 1 | 2 = isP1 ? 1 : 2
  const isTerminal =
    match.status === 'finished' ||
    match.status === 'retired' ||
    match.status === 'walkover'
  const won = isTerminal && match.winner_pair === myPair
  const lost = isTerminal && match.winner_pair != null && match.winner_pair !== myPair
  return { isP1, partner, opp1, opp2, myPair, won, lost }
}
