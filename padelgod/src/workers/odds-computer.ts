// padelgod/src/workers/odds-computer.ts
import type { SchedulerDeps } from '../scheduler.js'
import { computeOdds } from '../lib/odds/index.js'
import { buildOddsInput, type MatchRows } from '../lib/odds-state.js'

const LIVE = ['live', 'on_court', 'break']
const PREMATCH_TTL_MS = 5 * 60 * 1000

interface MatchRow {
  id: string
  status: string
  pair1_player1_id: string | null; pair1_player2_id: string | null
  pair2_player1_id: string | null; pair2_player2_id: string | null
}

export async function runOddsComputer(deps: SchedulerDeps): Promise<{
  computedLive: number; computedPreMatch: number; skipped: number; errors: number
}> {
  const { supabase, logger } = deps
  let computedLive = 0, computedPreMatch = 0, skipped = 0, errors = 0

  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const until = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString()
  const { data: matches, error } = await supabase
    .from('matches')
    .select('id,status,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id,scheduled_at')
    .or(`status.in.(${LIVE.join(',')}),and(status.eq.scheduled,scheduled_at.gte.${since},scheduled_at.lte.${until})`)
    .returns<MatchRow[]>()
  if (error) { logger.error({ worker: 'odds-computer', error: error.message }, 'match query failed'); return { computedLive, computedPreMatch, skipped, errors: 1 } }

  const ids = (matches ?? []).map((m) => m.id)
  const fresh = new Map<string, number>()
  if (ids.length) {
    const { data: existing } = await supabase.from('match_odds').select('match_id,computed_at').in('match_id', ids)
    for (const r of existing ?? []) fresh.set(r.match_id as string, new Date(r.computed_at as string).getTime())
  }

  for (const m of matches ?? []) {
    try {
      const isLive = LIVE.includes(m.status)
      if (!isLive) {
        const last = fresh.get(m.id)
        if (last && Date.now() - last < PREMATCH_TTL_MS) { skipped++; continue }
      }
      const rows = await loadMatchRows(supabase, m)
      const result = computeOdds(buildOddsInput(rows))
      await supabase.from('match_odds').upsert({
        match_id: m.id,
        pair1_win_prob: result.pair1WinProb,
        pair2_win_prob: result.pair2WinProb,
        pair1_fair_odds: result.pair1FairOdds,
        pair2_fair_odds: result.pair2FairOdds,
        confidence: result.confidence,
        model_version: 'v1',
        computed_at: new Date().toISOString(),
      }, { onConflict: 'match_id' })
      if (isLive) {
        await supabase.from('match_odds_snapshots').insert({ match_id: m.id, pair1_win_prob: result.pair1WinProb })
        computedLive++
      } else {
        computedPreMatch++
      }
    } catch (e) {
      errors++
      logger.warn({ worker: 'odds-computer', matchId: m.id, err: String(e) }, 'odds compute failed for match')
    }
  }
  logger.info({ worker: 'odds-computer', computedLive, computedPreMatch, skipped, errors }, 'odds-computer done')
  return { computedLive, computedPreMatch, skipped, errors }
}

async function loadMatchRows(
  supabase: SchedulerDeps['supabase'],
  m: MatchRow,
): Promise<MatchRows> {
  const playerIds = [m.pair1_player1_id, m.pair1_player2_id, m.pair2_player1_id, m.pair2_player2_id]
  const ranks = new Map<string, number | null>()
  const present = playerIds.filter((x): x is string => !!x)
  if (present.length) {
    const { data: players } = await supabase.from('players').select('id,ranking').in('id', present)
    for (const p of players ?? []) ranks.set(p.id as string, (p.ranking as number | null) ?? null)
  }
  const rankings = playerIds.map((id) => (id ? ranks.get(id) ?? null : null)) as MatchRows['rankings']

  const isLive = LIVE.includes(m.status)
  if (!isLive) return { rankings, status: m.status, sets: [], currentGame: null, hasRecentPoints: false }

  const { data: sets } = await supabase
    .from('sets').select('pair1_games,pair2_games,is_current').eq('match_id', m.id).order('set_number', { ascending: true })
  const { data: games } = await supabase
    .from('games').select('game_score,server_player_id,is_current').eq('match_id', m.id).eq('is_current', true).limit(1)
  const recentPointCutoff = new Date(Date.now() - 90 * 1000).toISOString()
  const { count } = await supabase
    .from('match_points').select('point_number', { count: 'exact', head: true })
    .eq('match_id', m.id).gte('created_at', recentPointCutoff)

  return {
    rankings,
    status: m.status,
    sets: (sets ?? []) as MatchRows['sets'],
    currentGame: games && games[0] ? { game_score: games[0].game_score as string | null, server_player_id: games[0].server_player_id as string | null } : null,
    hasRecentPoints: (count ?? 0) > 0,
  }
}
