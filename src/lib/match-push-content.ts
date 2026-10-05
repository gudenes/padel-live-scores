import { playerLastName } from './player-name'

interface PlayerLite { id: string; name: string | null; display_name: string | null; avatar_url: string | null }
interface SetLite {
  set_number: number | null
  set_score: string | null
  pair1_games: number | null
  pair2_games: number | null
}
export interface MatchRow {
  id: string
  status: string | null
  round: string | null
  winner_pair: number | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
  tournament: { name: string | null; level: string | null } | null
  pair1_player1: PlayerLite | null
  pair1_player2: PlayerLite | null
  pair2_player1: PlayerLite | null
  pair2_player2: PlayerLite | null
  sets: SetLite[] | null
}

export const FINISHED_STATUSES = new Set(['finished', 'retired', 'walkover', 'ended'])

export function buildBody(m: MatchRow): string {
  const lastNames = (a: PlayerLite | null, b: PlayerLite | null) =>
    [a, b].filter((p): p is PlayerLite => !!p && !!(p.display_name || p.name))
      .map(p => playerLastName(p)).join('/')
  const team1 = lastNames(m.pair1_player1, m.pair1_player2)
  const team2 = lastNames(m.pair2_player1, m.pair2_player2)
  const tournament = m.tournament?.name ?? ''
  const round = m.round ?? ''
  return `${team1} vs ${team2}${tournament ? ` — ${tournament}` : ''}${round ? ` ${round}` : ''}`
}

// ── Finished-event helpers ──────────────────────────────────────────
//
// Render a compact final score from the sets array. Prefers `set_score`
// (the authoritative string written by padelapi/relay, e.g. "6-3") and
// falls back to `{pair1_games}-{pair2_games}` for sets where the score
// string never landed (live-inferred sets). Sets are rendered in
// set_number order and joined with `, ` — "6-3, 4-6, 7-5".
function renderFinalScore(sets: SetLite[] | null | undefined): string {
  if (!sets || sets.length === 0) return ''
  const ordered = [...sets].sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
  const parts: string[] = []
  for (const s of ordered) {
    if (s.set_score) {
      parts.push(s.set_score)
      continue
    }
    if (s.pair1_games != null && s.pair2_games != null) {
      parts.push(`${s.pair1_games}-${s.pair2_games}`)
    }
  }
  return parts.join(', ')
}

// Build "<winners> won" name pair for the title, OR return null when we
// can't confidently identify the winners (missing winner_pair, missing
// player names). Callers fall back to a generic "Match finished" title.
function winnerPairName(m: MatchRow): string | null {
  if (m.winner_pair !== 1 && m.winner_pair !== 2) return null
  const pair = m.winner_pair === 1
    ? [m.pair1_player1, m.pair1_player2]
    : [m.pair2_player1, m.pair2_player2]
  const names = pair
    .map(p => (p?.display_name || p?.name ? playerLastName(p) : null))
    .filter((n): n is string => !!n)
  if (names.length === 0) return null
  return names.join('/')
}

interface FinishedContent {
  title: string
  body: string
}

// Finished-event content, tailored per recipient reason.
//
// bookmark (user bookmarked the match):
//   Title: "Match finished 🏆"
//   Body:  "Triay/Brea won 6-3, 6-4 — Brussels P2 R16"
//
// follow (user follows one of the 4 players):
//   Title: "<lastName> won 🏆"   OR   "<lastName> lost"
//   Body:  "6-3, 6-4 vs Rodriguez/Pozzo — Brussels P2 R16"
//   (The body shows the OPPONENT team to give the user their player's
//    context. Score is written from the followed-player's perspective.)
//
// retired/walkover:
//   Title: "Match ended"
//   Body:  "6-3 (retired) — …"  or "Walkover — …"
export function buildFinishedContent(
  m: MatchRow,
  reason: RecipientReason,
  followedPlayerId: string | null,
): FinishedContent {
  const tournament = m.tournament?.name ?? ''
  const round = m.round ?? ''
  const tail = [tournament, round].filter(Boolean).join(' ')
  const status = (m.status ?? '').toLowerCase()
  const isRetired = status === 'retired'
  const isWalkover = status === 'walkover'

  const score = renderFinalScore(m.sets)
  const winners = winnerPairName(m)

  // ── Walkover / retired special cases ─────────────────────────────
  if (isWalkover) {
    return {
      title: 'Match ended',
      body: `Walkover${tail ? ` — ${tail}` : ''}`,
    }
  }
  if (isRetired) {
    return {
      title: 'Match ended',
      body: `${score ? `${score} ` : ''}(retired)${tail ? ` — ${tail}` : ''}`,
    }
  }

  // ── Follow-reason — tailor title from the user's player's perspective ──
  if (reason.kind === 'follow' && reason.followedPlayerName && followedPlayerId) {
    const followedInPair1 = m.pair1_player1?.id === followedPlayerId || m.pair1_player2?.id === followedPlayerId
    const followedPairNum = followedInPair1 ? 1 : 2
    const userWon = m.winner_pair === followedPairNum
    const title = userWon
      ? `${reason.followedPlayerName} won 🏆`
      : `${reason.followedPlayerName} lost`
    // Opponent team for context
    const opp = followedPairNum === 1
      ? [m.pair2_player1, m.pair2_player2]
      : [m.pair1_player1, m.pair1_player2]
    const oppNames = opp
      .map(p => (p?.display_name || p?.name ? playerLastName(p) : null))
      .filter((n): n is string => !!n)
      .join('/')
    const body = [
      score,
      oppNames ? `vs ${oppNames}` : '',
      tail ? `— ${tail}` : '',
    ].filter(Boolean).join(' ')
    return { title, body }
  }

  // ── Bookmark reason (or follow fallback with no winner data) ─────
  const title = 'Match finished 🏆'
  const body = winners && score
    ? `${winners} won ${score}${tail ? ` — ${tail}` : ''}`
    : score
      ? `${score}${tail ? ` — ${tail}` : ''}`
      : buildBody(m) // final fallback — reuse the live-event body format
  return { title, body }
}

export interface RecipientReason {
  kind: 'bookmark' | 'follow'
  followedPlayerName?: string
  // Needed for finished-event body rendering — lets us tell which pair
  // the user's player was on (so we can render "won 6-3, 6-4" vs the
  // other team). Not used for live events.
  followedPlayerId?: string
}

