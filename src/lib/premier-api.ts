// src/lib/premier-api.ts
//
// Thin REST client for premierpadel.com's public "beforeauth" API.
// All endpoints accept multipart/form-data and return { status: 1, data: ... }.
// No auth header required.
//
// Endpoints wrapped by this module:
// - gettournamentsdropdown         → list of 75 Premier tournaments with dates
// - gettournamnetupcomingmatches   → match list for a tournament (note: vendor typo)
// - gettournamentsmatchdetail      → full stats payload for a single match
//
// Usage:
//   const tournaments = await fetchPremierTournamentDropdown()
//   const matches = await fetchPremierUpcomingMatches(285)
//   const detail = await fetchPremierMatchDetail(6190)

const API_BASE = 'https://premierpadel.com/premierpadel/api/'

// ── Tournament types ──────────────────────────────────────────

export interface PremierTournamentSummary {
  tournaments_id: number
  full_name: string
  accommodation_start_date: string  // 'YYYY-MM-DD' or empty
  accommodation_end_date: string
  is_live: 'Yes' | 'No'
  is_recent_tournament: 'Yes' | 'No'
}

// ── Match-list types ──────────────────────────────────────────

export interface PremierUpcomingMatch {
  tournaments_match_id: number
  tournaments_id: number
  tournament_name?: string
  draw_type?: string
  round?: string
  round_name?: string
  team1_player_name?: string
  team1_partner_name?: string
  team2_player_name?: string
  team2_partner_player_name?: string
  is_bye?: 'Yes' | 'No'
  status?: string
  // Other fields exist but we only consume these
}

// ── Match-detail types (stats payload) ────────────────────────

export interface PremierStatRowTeam {
  title: string | number
  won: string | number
  played: string | number
  percentage: string | number
  is_winner: 'Yes' | 'No'
}

export interface PremierStatRow {
  title: string
  team_1: PremierStatRowTeam
  team_2: PremierStatRowTeam
}

export interface PremierMatchStateSection {
  title: string  // 'Match' | 'set 1' | 'set 2' | 'set 3' | ...
  service: PremierStatRow[]
  return: PremierStatRow[]
  total_points?: PremierStatRow[]
}

export interface PremierMatchScore {
  tournaments_match_id: number
  tournaments_id: number
  tournament_name: string
  court_name: string
  date: string
  start_time: string
  matchId: string
  draw_type: string
  team1_player_name: string
  team1_partner_name: string
  team2_player_name: string
  team2_partner_player_name: string
  is_bye: 'Yes' | 'No'
  round: string
  round_name: string
  winner_id: string
  status: string
  team1_score: Record<string, number | string | null>
  team2_score: Record<string, number | string | null>
}

export interface PremierMatchDetail {
  match_score: PremierMatchScore
  match_state: PremierMatchStateSection[]
}

// ── Fetch helper ──────────────────────────────────────────────

interface FetchOpts {
  retries?: number
  timeoutMs?: number
}

async function premierFetch<T>(
  endpoint: string,
  fields: Record<string, string | number>,
  opts: FetchOpts = {}
): Promise<T> {
  const { retries = 3, timeoutMs = 10000 } = opts

  let lastErr: unknown
  for (let attempt = 0; attempt < retries; attempt++) {
    // Rebuild the body on each attempt — FormData streams can be consumed
    // on the first send, making retries silently send empty bodies.
    const body = new FormData()
    for (const [k, v] of Object.entries(fields)) body.append(k, String(v))

    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const res = await fetch(API_BASE + endpoint, {
        method: 'POST',
        body,
        signal: ctl.signal,
        cache: 'no-store',
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`Premier API ${endpoint} returned ${res.status}`)
      const json = (await res.json()) as { status: number; data: T }
      if (json.status !== 1) throw new Error(`Premier API ${endpoint} returned status=${json.status}`)
      return json.data
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 250 * Math.pow(4, attempt)))
      }
    }
  }
  throw lastErr
}

// ── Throttle helper ──────────────────────────────────────────
// Wraps a promise-returning function with a trailing sleep. Use inside a
// for loop to space out requests (Premier's rate limits are undocumented).

export async function withThrottle<T>(fn: () => Promise<T>, ms = 200): Promise<T> {
  const result = await fn()
  await new Promise(r => setTimeout(r, ms))
  return result
}

// ── Endpoint wrappers ────────────────────────────────────────

/**
 * Fetch the tournament dropdown list. Drops the "All" meta entry
 * (tournaments_id = 28) which is a filter placeholder, not a real tournament.
 */
export async function fetchPremierTournamentDropdown(lang = 'en'): Promise<PremierTournamentSummary[]> {
  const data = await premierFetch<PremierTournamentSummary[]>(
    'beforeauth/gettournamentsdropdown',
    { lang },
  )
  return Array.isArray(data) ? data.filter(t => t.tournaments_id !== 28) : []
}

/**
 * Fetch the match list for a single Premier tournament.
 * Note: endpoint name has a typo ("gettournamnet...") — that's vendor-side,
 * we mirror it exactly.
 */
export async function fetchPremierUpcomingMatches(
  tournamentsId: number,
): Promise<PremierUpcomingMatch[]> {
  const data = await premierFetch<{ tournaments_match: PremierUpcomingMatch[] }>(
    'beforeauth/gettournamnetupcomingmatches',
    { tournaments_id: tournamentsId },
  )
  return Array.isArray(data?.tournaments_match) ? data.tournaments_match : []
}

/**
 * Fetch the full stats payload for a single match.
 * Returns null when the match ID is not recognized (Premier returns
 * {status:1, data:[]} for unknown IDs rather than an error).
 */
export async function fetchPremierMatchDetail(
  matchId: number,
  lang = 'en',
): Promise<PremierMatchDetail | null> {
  try {
    const data = await premierFetch<PremierMatchDetail | unknown[]>(
      'beforeauth/gettournamentsmatchdetail',
      { tournaments_match_id: matchId, lang },
    )
    if (Array.isArray(data)) return null
    return data
  } catch (err) {
    console.error(`[premier-api] match detail ${matchId} failed:`, err)
    return null
  }
}
