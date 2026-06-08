// src/lib/seo/tournament-results.ts
// Pure builder for the server-rendered results list on the tournament page.
// The tournament page is 'use client' and only mounts the match list when the
// PARTIDOS tab is active, so the results — the page's most search-valuable
// content — are absent from the first-pass HTML and from the rendered DOM a
// crawler sees on the default tab. This builder turns normalized match rows
// into an ordered, link-bearing result list the server layout renders into
// the initial HTML for every crawler, independent of JS or tab state.
//
// Pure (no DB types, no joins) so it can be unit-tested without Supabase mocks.
// The layout wires the DB → input mapping.

export interface TournamentResultPlayer {
  id: string | null
  name: string
}

export interface TournamentResultMatchInput {
  id: string
  status: string | null
  round: string | null
  category: string | null
  winner_pair: number | null
  finished_at: string | null
  scheduled_at: string | null
  pair1: TournamentResultPlayer[]
  pair2: TournamentResultPlayer[]
  sets: Array<{ set_number: number; pair1_games: number | null; pair2_games: number | null }>
}

export interface TournamentResultRow {
  id: string
  round: string | null
  status: string | null
  /** Plain-text one-liner, e.g. "Galán / Chingotto beat Tapia / Coello 6-3, 7-5". */
  headline: string
  pair1: { players: TournamentResultPlayer[]; won: boolean }
  pair2: { players: TournamentResultPlayer[]; won: boolean }
  /** Set score string, or null for scheduled/score-less matches. */
  score: string | null
}

export interface TournamentResults {
  rows: TournamentResultRow[]
  finishedCount: number
  upcomingCount: number
}

function lastName(full: string): string {
  const parts = full.trim().split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
}

function pairLabel(players: TournamentResultPlayer[]): string {
  return players.map((p) => lastName(p.name)).filter(Boolean).join(' / ')
}

// Score string oriented to the winner's perspective. When pair 2 won, sets
// are flipped so the winner's games lead (e.g. raw 6-7, 3-6 → 7-6, 6-3).
function scoreString(
  sets: TournamentResultMatchInput['sets'],
  winnerIsPair2: boolean,
): string | null {
  const ordered = sets
    .slice()
    .sort((a, b) => a.set_number - b.set_number)
    .filter((s) => s.pair1_games != null || s.pair2_games != null)
  if (ordered.length === 0) return null
  return ordered
    .map((s) => {
      const a = s.pair1_games ?? 0
      const b = s.pair2_games ?? 0
      return winnerIsPair2 ? `${b}-${a}` : `${a}-${b}`
    })
    .join(', ')
}

// Derive the winner from the set scores rather than trusting winner_pair —
// FIP qualifying rows frequently carry a stale or inverted winner_pair that
// contradicts the games (which would render "X beat Y" with X's losing score).
// Returns 1, 2, or null when no pair clearly took more sets (incomplete data).
function winnerFromSets(sets: TournamentResultMatchInput['sets']): 1 | 2 | null {
  let p1 = 0
  let p2 = 0
  for (const s of sets) {
    if (s.pair1_games == null || s.pair2_games == null) continue
    if (s.pair1_games > s.pair2_games) p1++
    else if (s.pair2_games > s.pair1_games) p2++
  }
  if (p1 > p2) return 1
  if (p2 > p1) return 2
  return null
}

const FINISHED_STATUSES = new Set(['finished', 'retired', 'walkover', 'ended'])
const SPECIAL_STATUSES = new Set(['retired', 'walkover'])

function bestDate(m: TournamentResultMatchInput): number {
  const d = m.finished_at ?? m.scheduled_at
  return d ? new Date(d).getTime() : 0
}

/**
 * Build an ordered result list for a tournament. Finished matches first
 * (newest → oldest, so the latest/most-advanced rounds lead), then upcoming
 * matches (soonest → latest). Drops matches with no resolvable player names
 * on either side — they would render as " vs " and add no value.
 */
export function buildTournamentResults(
  matches: TournamentResultMatchInput[],
  opts?: { category?: 'men' | 'women' | null },
): TournamentResults {
  const filtered = matches.filter((m) => {
    if (opts?.category && m.category && m.category !== opts.category) return false
    const p1 = pairLabel(m.pair1)
    const p2 = pairLabel(m.pair2)
    return p1.length > 0 && p2.length > 0
  })

  const finished = filtered.filter((m) => FINISHED_STATUSES.has(m.status ?? ''))
  const upcoming = filtered.filter((m) => !FINISHED_STATUSES.has(m.status ?? ''))

  finished.sort((a, b) => bestDate(b) - bestDate(a))
  upcoming.sort((a, b) => bestDate(a) - bestDate(b))

  const rows: TournamentResultRow[] = [...finished, ...upcoming].map((m) => {
    const p1 = pairLabel(m.pair1)
    const p2 = pairLabel(m.pair2)
    const isFinished = FINISHED_STATUSES.has(m.status ?? '')
    const isSpecial = SPECIAL_STATUSES.has(m.status ?? '')

    // Winner: trust winner_pair only for retired/walkover (no completed-set
    // signal to derive from); otherwise derive from the games so the claim
    // always agrees with the score we print.
    let winner: 1 | 2 | null = null
    if (isSpecial && (m.winner_pair === 1 || m.winner_pair === 2)) {
      winner = m.winner_pair
    } else if (isFinished) {
      winner = winnerFromSets(m.sets)
    }

    // Omit the score for retired/walkover — it's a mid-match snapshot where the
    // winner is often behind, so printing it reads as a loss. A status suffix
    // carries the meaning instead.
    const score = winner && !isSpecial ? scoreString(m.sets, winner === 2) : null
    const suffix =
      m.status === 'retired' ? ' (retired)' : m.status === 'walkover' ? ' (walkover)' : ''

    let headline: string
    if (winner) {
      const winNames = winner === 1 ? p1 : p2
      const loseNames = winner === 1 ? p2 : p1
      headline = `${winNames} beat ${loseNames}${score ? ` ${score}` : ''}${suffix}`
    } else if (m.status === 'live') {
      const liveScore = scoreString(m.sets, false)
      headline = liveScore ? `${p1} vs ${p2} — live ${liveScore}` : `${p1} vs ${p2} — live`
    } else {
      headline = `${p1} vs ${p2}`
    }

    return {
      id: m.id,
      round: m.round?.trim() || null,
      status: m.status,
      headline,
      pair1: { players: m.pair1, won: winner === 1 },
      pair2: { players: m.pair2, won: winner === 2 },
      score,
    }
  })

  return { rows, finishedCount: finished.length, upcomingCount: upcoming.length }
}
