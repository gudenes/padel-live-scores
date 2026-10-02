// src/lib/coach-page-data.ts
// Data for /coach/[slug] and /coaches (spec 2026-10-02-coach-pages-design.md).
// Pure shaping functions on top; fetchers (anon server client) below.

export type CoachTab = 'overall' | 'men' | 'women'

export interface CoachRankingRow {
  coach_id: string; display_name: string; slug: string; player_count: number
  men_points: number; women_points: number; total_points: number
  rank_overall: number; rank_men: number; rank_women: number
}

export interface CoachPlayer {
  id: string; name: string; display_name: string | null; country: string | null
  category: string | null; ranking: number | null; points: number | null; avatar_url: string | null
}

export interface PairPlayer { id: string; name: string; display_name: string | null }

export interface FinalRow {
  match_id: string; category: string | null; winner_pair: number | null
  pair1: PairPlayer[]; pair2: PairPlayer[]
  tournament: { id: string; name: string; level: string | null; starts_at: string | null; ends_at: string | null }
}

export interface CoachTitle {
  key: string; tournamentId: string; tournamentName: string; level: string | null
  category: string | null; pair: string; date: string | null
}

export interface UpcomingRow {
  match_id: string; status: string; scheduled_at: string | null; round: string | null
  tournament_name: string; pair1: string; pair2: string
}

const TEAM_LEAGUE_LEVELS = new Set(['ppl', 'ppl_ii'])
const STALE_SCHEDULED_MS = 3 * 60 * 60 * 1000
const LIVE_STATUSES = new Set(['live', 'on_court'])

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]![0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : ''
  return (first + last).toUpperCase()
}

export function shortPlayerName(p: { name: string; display_name: string | null }): string {
  const display = p.display_name?.trim()
  if (display) return display
  const parts = p.name.trim().split(/\s+/)
  return parts.length > 1 ? parts[parts.length - 1]! : p.name.trim()
}

const byRanking = (a: CoachPlayer, b: CoachPlayer) =>
  (a.ranking ?? Number.MAX_SAFE_INTEGER) - (b.ranking ?? Number.MAX_SAFE_INTEGER)

export function splitPlayers(players: CoachPlayer[]): { men: CoachPlayer[]; women: CoachPlayer[] } {
  return {
    men: players.filter((p) => p.category !== 'women').sort(byRanking),
    women: players.filter((p) => p.category === 'women').sort(byRanking),
  }
}

export function shapeTitles(rows: FinalRow[], coachedIds: Set<string>, year: number): CoachTitle[] {
  const seen = new Set<string>()
  const out: CoachTitle[] = []
  for (const r of rows) {
    if (r.winner_pair !== 1 && r.winner_pair !== 2) continue
    if (r.tournament.level && TEAM_LEAGUE_LEVELS.has(r.tournament.level)) continue
    const start = r.tournament.starts_at ? new Date(r.tournament.starts_at) : null
    if (!start || start.getUTCFullYear() !== year) continue
    const winners = r.winner_pair === 1 ? r.pair1 : r.pair2
    if (!winners.some((w) => coachedIds.has(w.id))) continue
    const key = `${r.tournament.id}|${r.category ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      key, tournamentId: r.tournament.id, tournamentName: r.tournament.name, level: r.tournament.level,
      category: r.category, pair: winners.map(shortPlayerName).join(' / '),
      date: r.tournament.ends_at ?? r.tournament.starts_at,
    })
  }
  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

export function pickNextMatches(rows: UpcomingRow[], now: Date = new Date()): UpcomingRow[] {
  const cutoff = now.getTime() - STALE_SCHEDULED_MS
  const live = rows.filter((r) => LIVE_STATUSES.has(r.status))
  const scheduled = rows
    .filter((r) => r.status === 'scheduled' && r.scheduled_at && new Date(r.scheduled_at).getTime() >= cutoff)
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
  return [...live, ...scheduled].slice(0, 3)
}

export function isIndexable(row: { total_points: number }): boolean {
  return Number(row.total_points) > 0
}

export function topPlayerNames(players: CoachPlayer[]): { names: string[]; more: number } {
  const sorted = [...players].sort((a, b) => Number(b.points ?? 0) - Number(a.points ?? 0))
  return { names: sorted.slice(0, 2).map(shortPlayerName), more: Math.max(0, sorted.length - 2) }
}
