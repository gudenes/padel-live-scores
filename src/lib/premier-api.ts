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
