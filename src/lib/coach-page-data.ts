// src/lib/coach-page-data.ts
// Data for /coach/[slug] and /coaches (spec 2026-10-02-coach-pages-design.md).
// Pure shaping functions on top; fetchers (anon server client) below.

import type { SupabaseClient } from '@supabase/supabase-js'
import { playerShortName } from '@/lib/player-short-name'

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
const STUCK_LIVE_MS = 18 * 60 * 60 * 1000
const LIVE_STATUSES = new Set(['live', 'on_court'])

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]![0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : ''
  return (first + last).toUpperCase()
}

export function shortPlayerName(p: { name: string; display_name: string | null }): string {
  return p.display_name?.trim() || playerShortName(p.name)
}

const byRanking = (a: CoachPlayer, b: CoachPlayer) =>
  (a.ranking ?? Number.MAX_SAFE_INTEGER) - (b.ranking ?? Number.MAX_SAFE_INTEGER)

export function splitPlayers(players: CoachPlayer[]): { men: CoachPlayer[]; women: CoachPlayer[] } {
  return {
    men: players.filter((p) => p.category === 'men').sort(byRanking),
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
  const liveCutoff = now.getTime() - STUCK_LIVE_MS
  // Stuck-live guard: a "live" row scheduled >18h ago is a stale row, not a live match.
  const live = rows.filter((r) =>
    LIVE_STATUSES.has(r.status) && (!r.scheduled_at || new Date(r.scheduled_at).getTime() >= liveCutoff))
  const scheduled = rows
    .filter((r) => r.status === 'scheduled' && r.scheduled_at && new Date(r.scheduled_at).getTime() >= cutoff)
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
  return [...live, ...scheduled].slice(0, 3)
}

const KEEP_UPPER = new Set(['FIP', 'BNL', 'ITF', 'WPT', 'UK', 'USA', 'UAE'])

/** Title-case a tournament name only when it is stored entirely upper-case; keep known acronyms. */
export function formatTournamentName(name: string): string {
  if (name !== name.toUpperCase() || name === name.toLowerCase()) return name
  return name
    .toLowerCase()
    .replace(/\p{L}[\p{L}\p{N}']*/gu, (w) => {
      const up = w.toUpperCase()
      if (KEEP_UPPER.has(up) || (w.length <= 3 && /\d/.test(w))) return up
      return w[0]!.toUpperCase() + w.slice(1)
    })
}

export interface ListGroup<T> { key: string; heading: T; rows: T[] }

/** Slice grouped rows by ROW count (headings are free). Hidden count = hidden rows. */
export function visibleGroups<T>(groups: ListGroup<T>[], initialRows: number): { groups: ListGroup<T>[]; hidden: number } {
  let left = initialRows
  let total = 0
  const out: ListGroup<T>[] = []
  for (const g of groups) {
    total += g.rows.length
    if (left <= 0) continue
    const rows = g.rows.slice(0, left)
    left -= rows.length
    if (rows.length) out.push({ ...g, rows })
  }
  return { groups: out, hidden: Math.max(0, total - initialRows) }
}

export function isIndexable(row: { total_points: number }): boolean {
  return Number(row.total_points) > 0
}

export function topPlayerNames(players: CoachPlayer[]): { names: string[]; more: number } {
  const sorted = [...players].sort((a, b) => Number(b.points ?? 0) - Number(a.points ?? 0))
  return { names: sorted.slice(0, 2).map(shortPlayerName), more: Math.max(0, sorted.length - 2) }
}

const PLAYER_COLS = 'id, name, display_name, country, category, ranking, points, avatar_url, tier'
const PAIR_EMBED =
  'pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name),' +
  'pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name),' +
  'pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name),' +
  'pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name)'

type MatchWithPairs = {
  id: string; status: string; scheduled_at: string | null; round: string | null; category: string | null; winner_pair: number | null
  tournament: FinalRow['tournament'] | null
  pair1_player1: PairPlayer | null; pair1_player2: PairPlayer | null; pair2_player1: PairPlayer | null; pair2_player2: PairPlayer | null
}

const involving = (ids: string[]) => {
  const list = ids.join(',')
  return `pair1_player1_id.in.(${list}),pair1_player2_id.in.(${list}),pair2_player1_id.in.(${list}),pair2_player2_id.in.(${list})`
}
const pairOf = (a: PairPlayer | null, b: PairPlayer | null) => [a, b].filter((x): x is PairPlayer => !!x)

export type CoachPageResult =
  | { kind: 'ok'; coach: CoachRankingRow; players: CoachPlayer[]; titles: CoachTitle[]; next: UpcomingRow[]; year: number }
  | { kind: 'redirect'; slug: string }
  | { kind: 'not_found' }

export async function fetchCoachPage(sb: SupabaseClient, slug: string, now: Date = new Date()): Promise<CoachPageResult> {
  const { data: coach, error } = await sb.from('coach_rankings_public').select('*').eq('slug', slug).maybeSingle()
  if (error) throw new Error(`coach_rankings_public: ${error.message}`)
  if (!coach) {
    const { data: r, error: rErr } = await sb.from('coach_slug_redirects').select('new_slug').eq('old_slug', slug).maybeSingle()
    if (rErr) throw new Error(`coach_slug_redirects: ${rErr.message}`)
    return r?.new_slug ? { kind: 'redirect', slug: r.new_slug } : { kind: 'not_found' }
  }

  const { data: links, error: linkErr } = await sb.from('player_coaches_public').select('player_id').eq('coach_id', coach.coach_id)
  if (linkErr) throw new Error(`player_coaches_public: ${linkErr.message}`)
  const ids = (links ?? []).map((l) => l.player_id as string)
  const { data: players, error: pErr } = ids.length
    ? await sb.from('players').select(PLAYER_COLS).in('id', ids).or('tier.is.null,tier.eq.pro')
    : { data: [], error: null }
  if (pErr) throw new Error(`players: ${pErr.message}`)

  const year = now.getUTCFullYear()
  let titles: CoachTitle[] = []
  let next: UpcomingRow[] = []
  if (ids.length) {
    const matchCols = `id, status, scheduled_at, round, category, winner_pair, tournament:tournaments(id, name, level, starts_at, ends_at), ${PAIR_EMBED}`
    const [finals, liveRes, schedRes] = await Promise.all([
      sb.from('matches')
        .select(`id, status, scheduled_at, round, category, winner_pair, tournament:tournaments!inner(id, name, level, starts_at, ends_at), ${PAIR_EMBED}`)
        .eq('round_canonical', 'F')
        .in('status', ['finished', 'retired', 'walkover'])
        .gte('tournament.starts_at', `${year}-01-01`)
        .or(involving(ids))
        .limit(200),
      // Live rows are filtered by players + status only; stale ones are dropped in pickNextMatches.
      sb.from('matches').select(matchCols)
        .in('status', ['live', 'on_court'])
        .or(involving(ids))
        .limit(20),
      sb.from('matches').select(matchCols)
        .eq('status', 'scheduled')
        .gte('scheduled_at', new Date(now.getTime() - 3 * 3600_000).toISOString())
        .or(involving(ids))
        .order('scheduled_at')
        .limit(20),
    ])
    if (finals.error) console.warn('[coach] titles query failed', finals.error.message)
    else {
      const rows = (finals.data as unknown as MatchWithPairs[]).filter((m) => m.tournament).map((m): FinalRow => ({
        match_id: m.id, category: m.category, winner_pair: m.winner_pair,
        pair1: pairOf(m.pair1_player1, m.pair1_player2), pair2: pairOf(m.pair2_player1, m.pair2_player2),
        tournament: m.tournament!,
      }))
      titles = shapeTitles(rows, new Set(ids), year)
    }
    if (liveRes.error || schedRes.error) console.warn('[coach] next matches query failed', (liveRes.error ?? schedRes.error)!.message)
    else {
      const rows = [...(liveRes.data as unknown as MatchWithPairs[]), ...(schedRes.data as unknown as MatchWithPairs[])].map((m): UpcomingRow => ({
        match_id: m.id, status: m.status, scheduled_at: m.scheduled_at, round: m.round,
        tournament_name: m.tournament?.name ?? '',
        pair1: pairOf(m.pair1_player1, m.pair1_player2).map(shortPlayerName).join(' / '),
        pair2: pairOf(m.pair2_player1, m.pair2_player2).map(shortPlayerName).join(' / '),
      }))
      next = pickNextMatches(rows, now)
    }
  }

  return { kind: 'ok', coach: coach as CoachRankingRow, players: (players ?? []) as CoachPlayer[], titles, next, year }
}

export const INDEX_PAGE_SIZE = 50

export interface CoachIndexRow extends CoachRankingRow {
  top: { names: string[]; more: number }
  /** Players actually counted for the active tab (men/women/all), after tier filtering. */
  tab_player_count: number
}

export async function fetchCoachesIndex(
  sb: SupabaseClient, tab: CoachTab, page: number,
): Promise<{ rows: CoachIndexRow[]; hasMore: boolean }> {
  const col = tab === 'men' ? 'men_points' : tab === 'women' ? 'women_points' : 'total_points'
  const pageNo = Math.max(1, Math.floor(Number(page)) || 1)
  const from = (pageNo - 1) * INDEX_PAGE_SIZE
  let q = sb.from('coach_rankings_public').select('*')
  q = q.gt(col, 0)
  const { data, error } = await q.order(col, { ascending: false }).order('display_name').order('coach_id').range(from, from + INDEX_PAGE_SIZE)
  if (error) throw new Error(`coach_rankings_public: ${error.message}`)
  const all = (data ?? []) as CoachRankingRow[]
  const rows = all.slice(0, INDEX_PAGE_SIZE)

  const coachIds = rows.map((r) => r.coach_id)
  const byCoach = new Map<string, CoachPlayer[]>()
  if (coachIds.length) {
    const { data: links, error: lErr } = await sb.from('player_coaches_public').select('coach_id, player_id').in('coach_id', coachIds)
    if (lErr) console.warn('[coaches] links query failed', lErr.message)
    const playerIds = [...new Set((links ?? []).map((l) => l.player_id as string))]
    const players = new Map<string, CoachPlayer>()
    for (let i = 0; i < playerIds.length; i += 200) {
      const { data: ps, error: psErr } = await sb.from('players').select(PLAYER_COLS).in('id', playerIds.slice(i, i + 200)).or('tier.is.null,tier.eq.pro')
      if (psErr) console.warn('[coaches] players query failed', psErr.message)
      for (const p of (ps ?? []) as CoachPlayer[]) players.set(p.id, p)
    }
    for (const l of links ?? []) {
      const p = players.get(l.player_id as string)
      if (!p) continue
      if (tab === 'men' && p.category !== 'men') continue
      if (tab === 'women' && p.category !== 'women') continue
      byCoach.set(l.coach_id as string, [...(byCoach.get(l.coach_id as string) ?? []), p])
    }
  }
  return {
    rows: rows.map((r) => {
      const ps = byCoach.get(r.coach_id) ?? []
      return { ...r, top: topPlayerNames(ps), tab_player_count: ps.length }
    }),
    hasMore: all.length > INDEX_PAGE_SIZE,
  }
}
