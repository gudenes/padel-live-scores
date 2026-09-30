/** Version-one editorial resolvers. Scope and deadlines are frozen on creation. */
import type { Resolver, ResolverContext, ResolverResult } from './types.js'

type Row = Record<string, unknown>
const MAIN = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']
const COMPLETE = new Set(['finished', 'retired'])
const COLUMNS = 'id,tournament_id,round_canonical,status,winner_pair,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id'
const pending: ResolverResult = { state: 'undecided' }
function text(p: Row, key: string): string {
  if (typeof p[key] !== 'string' || !p[key]) throw new Error(`Missing ${key}`)
  return p[key] as string
}
function positive(p: Row, key: string): number {
  const n = p[key]
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new Error(`Invalid ${key}`)
  return n
}
function pair(p: Row): [string, string] {
  const ids: [string, string] = [text(p, 'player1Id'), text(p, 'player2Id')]
  if (ids[0] === ids[1]) throw new Error('A pair requires two different players')
  return ids
}
function side(r: Row, ids: [string, string]): number | null {
  for (const n of [1, 2]) {
    const a = r[`pair${n}_player1_id`], b = r[`pair${n}_player2_id`]
    if ((a === ids[0] && b === ids[1]) || (a === ids[1] && b === ids[0])) return n
  }
  return null
}
function knownPair(r: Row, n: number): boolean {
  const a = r[`pair${n}_player1_id`], b = r[`pair${n}_player2_id`]
  return typeof a === 'string' && typeof b === 'string' && a !== b
}
function winner(r: Row): number | null {
  return COMPLETE.has(String(r.status)) && (r.winner_pair === 1 || r.winner_pair === 2)
    && knownPair(r, r.winner_pair) ? r.winner_pair : null
}
function decided(outcome: boolean, evidence: Row): ResolverResult {
  return { state: 'decided', outcome, evidence }
}
function deadline(p: Row, key: string): Date {
  const date = new Date(text(p, key))
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${key}`)
  return date
}
function unresolved(ctx: ResolverContext, p: Row): ResolverResult {
  return ctx.now >= deadline(p, 'voidAfter')
    ? { state: 'void', reason: 'Required official evidence remained incomplete at the frozen review deadline' }
    : pending
}
async function matches(ctx: ResolverContext, ids: string[]): Promise<Row[]> {
  if (!ctx.category) throw new Error('A draw category is required')
  const { data, error } = await ctx.supabase.from('matches').select(COLUMNS)
    .in('tournament_id', ids).eq('category', ctx.category).in('round_canonical', MAIN).limit(1000)
  if (error) throw new Error(error.message)
  // Fail closed if the bounded response might be truncated.
  if ((data?.length ?? 0) >= 1000) throw new Error('Match coverage may be truncated')
  return (data ?? []) as Row[]
}

/** A scheduled draw slot is not participation. Require play to have started. */
export const pairReachesRound: Resolver = async (ctx, p) => {
  const ids = pair(p), target = text(p, 'round')
  if (!['SF', 'F'].includes(target) || !ctx.tournamentId) throw new Error('Expected tournament and SF/F round')
  deadline(p, 'voidAfter')
  const rows = await matches(ctx, [ctx.tournamentId])
  const played = rows.filter(r => side(r, ids) !== null && (['live','on_court'].includes(String(r.status)) || COMPLETE.has(String(r.status))))
  const reached = played.find(r => MAIN.indexOf(String(r.round_canonical)) >= MAIN.indexOf(target))
  const lostBefore = played.find(r => MAIN.indexOf(String(r.round_canonical)) < MAIN.indexOf(target)
    && winner(r) !== null && winner(r) !== side(r, ids))
  if (reached && lostBefore) return unresolved(ctx, p)
  if (reached) return decided(true, { match_id: reached.id, round: reached.round_canonical, asked_pair: ids })
  if (lostBefore) return decided(false, { eliminated_match_id: lostBefore.id, asked_pair: ids })
  return unresolved(ctx, p)
}

export const otherPairWinsTournament: Resolver = async (ctx, p) => {
  const ids = pair(p)
  if (!ctx.tournamentId) throw new Error('Tournament required')
  deadline(p, 'voidAfter')
  const finals = (await matches(ctx, [ctx.tournamentId])).filter(r => r.round_canonical === 'F')
  if (finals.length !== 1 || winner(finals[0]!) === null) return unresolved(ctx, p)
  const f = finals[0]!
  return decided(winner(f) !== side(f, ids), { final_match_id: f.id, winner_pair: winner(f), excluded_pair: ids })
}

/** The creator freezes the complete eligible event list, never a mutable calendar query. */
export const pairTitleCount: Resolver = async (ctx, p) => {
  const ids = pair(p), threshold = positive(p, 'titles'), minimumStarts = positive(p, 'minimumStarts')
  const eventIds = p.tournamentIds
  if (!Array.isArray(eventIds) || !eventIds.length || eventIds.length > 12
    || !eventIds.every(id => typeof id === 'string' && id.length > 0)
    || new Set(eventIds).size !== eventIds.length) throw new Error('Freeze 1–12 distinct tournamentIds')
  if (threshold > eventIds.length || minimumStarts > eventIds.length) throw new Error('Threshold exceeds scope')
  const end = deadline(p, 'endsAt'), voidAfter = deadline(p, 'voidAfter')
  if (voidAfter <= end) throw new Error('Review deadline must follow the event window')
  const rows = await matches(ctx, eventIds as string[])
  const finals = eventIds.map(id => rows.filter(r => r.tournament_id === id && r.round_canonical === 'F'))
  if (finals.some(group => group.length > 1)) return unresolved(ctx, p)
  const won = finals.flat().filter(r => winner(r) !== null && winner(r) === side(r, ids))
  if (won.length >= threshold) return decided(true, { final_match_ids: won.map(r => r.id), asked_pair: ids, titles: won.length })
  if (ctx.now < end) return pending
  const starts = new Set(rows.filter(r => side(r, ids) !== null && COMPLETE.has(String(r.status))).map(r => r.tournament_id))
  if (finals.every(group => group.length === 1 && winner(group[0]!) !== null) && starts.size >= minimumStarts) {
    return decided(false, { final_match_ids: finals.flat().map(r => r.id), starts: starts.size, titles: won.length, asked_pair: ids })
  }
  return unresolved(ctx, p)
}

export const playerReachesRanking: Resolver = async (ctx, p) => {
  const playerId = text(p, 'playerId'), rank = positive(p, 'rank')
  const start = deadline(p, 'startsAt'), end = deadline(p, 'endsAt'), voidAfter = deadline(p, 'voidAfter')
  if (start >= end || end >= voidAfter) throw new Error('Invalid ranking window')
  const { data, error } = await ctx.supabase.from('player_ranking_snapshots')
    .select('ranking_date,ranking').eq('player_id', playerId).eq('type', 'official')
    .gte('ranking_date', start.toISOString().slice(0, 10))
    .lte('ranking_date', new Date(Math.min(end.getTime(), ctx.now.getTime())).toISOString().slice(0, 10)).limit(1000)
  if (error) throw new Error(error.message)
  if ((data?.length ?? 0) >= 1000) throw new Error('Ranking coverage may be truncated')
  const rows = (data ?? []) as Row[]
  const valid = rows.filter(r => typeof r.ranking === 'number' && Number.isInteger(r.ranking) && r.ranking > 0)
  // Conflicting snapshots must be reviewed, never choose the more favourable row.
  if (new Set(rows.map(r => r.ranking_date)).size !== rows.length) return unresolved(ctx, p)
  const hit = valid.find(r => Number(r.ranking) <= rank)
  if (hit) return decided(true, { player_id: playerId, ranking: hit.ranking, ranking_date: hit.ranking_date })
  if (ctx.now <= end) return pending
  // Official snapshots are labelled with their Monday. Every in-window week is required for NO.
  const expected: string[] = []
  const monday = new Date(start.toISOString().slice(0, 10) + 'T00:00:00Z')
  monday.setUTCDate(monday.getUTCDate() + (8 - monday.getUTCDay()) % 7)
  for (; monday <= end; monday.setUTCDate(monday.getUTCDate() + 7)) expected.push(monday.toISOString().slice(0, 10))
  const dates = new Set(valid.map(r => r.ranking_date))
  if (expected.length && expected.every(d => dates.has(d))) return decided(false, { player_id: playerId, checked_dates: expected, threshold: rank })
  return unresolved(ctx, p)
}
