// apps/ops/src/app/(app)/today/_lib/scoreboard-data.ts
import { createServiceClient } from '@/lib/supabase'
import { getMatchOddsForDay } from '@/lib/odds-data'
import type { Match, MatchStatus, AnchorSource, LiveOddsSnapshot } from './types'
import { movement15m, coverageToConfidence, biggestSwing, type ProbPoint } from './movement'
import { splitGameScore } from './score'
import { attachScoreToSeries, scoreTimeline, type PointRow, type PairIds } from './score-timeline'

export function shortName(name: string | null | undefined): string {
  if (!name) return '—'
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1] || '—'
}

const SURNAME_PARTICLES = new Set([
  'di','de','del','della','da','dos','das','van','von','la','le','lo','du','den','der','ten','ter','bin','el',
])

// Broadcast-style short name: first initial + paternal (first) surname,
// keeping leading surname particles ("Di Nenno", "De La Fuente").
// Trade-off (rare): compound GIVEN names ("Juan Ignacio De Pascual") take the
// second token as the surname start ("J. Ignacio") — acceptable, matches the
// existing playerShortName trade-off.
export function displayName(name: string | null | undefined): string {
  if (!name) return '—'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0]
  const initial = parts[0][0]!.toUpperCase()
  let i = 1
  const surname: string[] = []
  while (i < parts.length && SURNAME_PARTICLES.has(parts[i].toLowerCase())) {
    surname.push(parts[i]); i++
  }
  if (i < parts.length) surname.push(parts[i])
  const tail = surname.join(' ') || parts[parts.length - 1]
  return `${initial}. ${tail}`
}

const pairName = (a: string | null, b: string | null) =>
  [displayName(a), displayName(b)].filter((x) => x !== '—').join(' / ') || 'TBD'

// Raw `matches.status` values that mean a match is NOT genuinely upcoming —
// either already in play or in a terminal state. Everything else (notably
// 'scheduled', plus any null/unknown pre-start value) counts as upcoming.
const NON_UPCOMING = new Set(['live', 'on_court', 'break', 'ended', 'finished', 'retired', 'walkover'])
export function isUpcomingStatus(status: string | null | undefined): boolean {
  return !NON_UPCOMING.has((status ?? '').toLowerCase())
}

// Was the pre-match Elo favorite the actual winner? The favorite is pair1 when
// `pair1Prob >= 0.5`, else pair2. Returns null when we can't decide: missing prob,
// unknown winner, or an exact 0.5 tie (no favorite).
export function predictionCorrect(pair1Prob: number | null | undefined, winnerPair: 1 | 2 | null): boolean | null {
  if (pair1Prob == null || winnerPair == null) return null
  if (pair1Prob === 0.5) return null              // no favorite
  const favored = pair1Prob >= 0.5 ? 1 : 2
  return favored === winnerPair
}

const statusOf = (s: string): MatchStatus =>
  s === 'break' ? 'break' : s === 'live' || s === 'on_court' ? 'live' : 'scheduled'

export type ScoreboardKind = 'live' | 'finished' | 'scheduled'

export function scoreboardKind(status: string | null | undefined): ScoreboardKind {
  const s = (status ?? '').toLowerCase()
  if (s === 'live' || s === 'on_court' || s === 'break') return 'live'
  if (s === 'finished' || s === 'retired' || s === 'walkover') return 'finished'
  return 'scheduled'
}

export function mapSnapshotRows(
  rows: Array<{ pair1_prob: number | string; computed_at: string }>,
): Array<{ atMs: number; pair1Prob: number }> {
  return rows.map((s) => ({ atMs: +new Date(s.computed_at), pair1Prob: Number(s.pair1_prob) }))
}

// Live-odds snapshots stop when the match leaves on-court, so the last tick
// is the last model estimate (often 80–99%), not a settled result. For a
// finished match the winner is certain: append 100% / 0% if it isn't there.
const SETTLED_EPS = 1e-6
export function settleFinishedWinProb(
  history: Array<{ atMs: number; pair1Prob: number }>,
  winnerPair: 1 | 2 | null,
  endedAtMs?: number | null,
): { series: Array<{ atMs: number; pair1Prob: number }>; pair1Prob: number } {
  if (winnerPair !== 1 && winnerPair !== 2) {
    const last = history[history.length - 1]
    return { series: history, pair1Prob: last?.pair1Prob ?? 0.5 }
  }
  const terminal = winnerPair === 1 ? 1 : 0
  const last = history[history.length - 1]
  if (last && Math.abs(last.pair1Prob - terminal) < SETTLED_EPS) {
    return { series: history, pair1Prob: terminal }
  }
  const atMs =
    endedAtMs != null && endedAtMs >= (last?.atMs ?? 0)
      ? endedAtMs
      : (last?.atMs ?? 0) + 1000
  return { series: [...history, { atMs, pair1Prob: terminal }], pair1Prob: terminal }
}

// Shape of a match_live_odds row joined to match/player/tournament display fields.
export interface LiveOddsRow {
  match_id: string
  pair1_prob: number; pair2_prob: number
  pair1_decimal_odds: number; pair2_decimal_odds: number
  anchor_source: AnchorSource
  coverage: 'live-pbp' | 'live-coarse'
  computed_at: string
  matches: {
    status: string; court: string | null; round_canonical: string | null; category: string
    tournament: { name: string | null; level: string | null } | null
    p1a: { id: string; name: string | null } | null
    p1b: { id: string; name: string | null } | null
    p2a: { id: string; name: string | null } | null
    p2b: { id: string; name: string | null } | null
  } | null
}

export interface LiveExtras {
  sets: Array<{ pair1_games: number; pair2_games: number; is_current: boolean }>
  gameScore: string | null
  servingPlayerId: string | null
  history: ProbPoint[]
  currentSetStartedAt: string | null
  prematchPair1Prob: number | null   // latest model_predictions.pair1_prob (pre-match)
}

export function mapLiveRowToMatch(row: LiveOddsRow, extra: LiveExtras, nowMs: number): Match {
  const m = row.matches
  const serving = extra.servingPlayerId
  const p1a = m?.p1a?.id, p1b = m?.p1b?.id
  const servingPair1 = serving != null && (serving === p1a || serving === p1b)
  const servingPair2 = serving != null && (serving === m?.p2a?.id || serving === m?.p2b?.id)
  const status = statusOf(m?.status ?? 'scheduled')
  return {
    id: row.match_id,
    pair1: {
      name: pairName(m?.p1a?.name ?? null, m?.p1b?.name ?? null),
      player1Name: m?.p1a?.name ?? 'TBD', player2Name: m?.p1b?.name ?? 'TBD',
      gender: (m?.category === 'women' ? 'women' : 'men'),
      serving: status !== 'scheduled' && servingPair1,
    },
    pair2: {
      name: pairName(m?.p2a?.name ?? null, m?.p2b?.name ?? null),
      player1Name: m?.p2a?.name ?? 'TBD', player2Name: m?.p2b?.name ?? 'TBD',
      gender: (m?.category === 'women' ? 'women' : 'men'),
      serving: status !== 'scheduled' && servingPair2,
    },
    tournament: m?.tournament?.name ?? 'Unknown',
    court: m?.court ?? null,
    round: m?.round_canonical ?? null,
    tier: m?.tournament?.level ?? null,
    status,
    scheduledAt: null,
    setScores: extra.sets.map((s) => ({ a: s.pair1_games, b: s.pair2_games, current: s.is_current })),
    gamePoints: status === 'live' ? splitGameScore(extra.gameScore) : null,
    winProb1: Number(row.pair1_prob),
    fairOdds1: Number(row.pair1_decimal_odds),
    fairOdds2: Number(row.pair2_decimal_odds),
    movement15m: movement15m(extra.history, nowMs),
    confidence: coverageToConfidence(row.coverage),
    anchorSource: row.anchor_source,
    lastUpdatedSeconds: Math.max(0, Math.round((nowMs - +new Date(row.computed_at)) / 1000)),
    winProbSeries: extra.history.map((h) => ({ atMs: h.atMs, pair1Prob: h.prob })),
    currentSetStartedAt: extra.currentSetStartedAt,
    winnerPair: null,
    prematch: extra.prematchPair1Prob != null ? { pair1Prob: extra.prematchPair1Prob, correct: null } : null,
  }
}

export interface FinishedRow {
  id: string
  status: string                 // 'finished' | 'retired' | 'walkover'
  winner_pair: number | null
  court: string | null
  round_canonical: string | null
  category: string
  scheduled_at: string | null
  finished_at: string | null
  tournament: { name: string | null; level: string | null } | { name: string | null; level: string | null }[] | null
  p1a: { id: string; name: string | null } | null
  p1b: { id: string; name: string | null } | null
  p2a: { id: string; name: string | null } | null
  p2b: { id: string; name: string | null } | null
}
export interface FinishedExtras {
  sets: Array<{ pair1_games: number; pair2_games: number }>
  closing: { pair1_prob: number; pair1_decimal_odds: number; pair2_decimal_odds: number; coverage: string | null } | null
  history: Array<{ atMs: number; pair1Prob: number }>  // pair1 win-prob series for the chart (oldest→newest)
  prematchPair1Prob: number | null   // latest model_predictions.pair1_prob (pre-match)
}

export function mapFinishedRowToMatch(row: FinishedRow, extra: FinishedExtras): Match {
  const t = Array.isArray(row.tournament) ? row.tournament[0] : row.tournament
  const pn = (a: { name: string | null } | null, b: { name: string | null } | null) =>
    [displayName(a?.name ?? null), displayName(b?.name ?? null)].filter((x) => x !== '—').join(' / ') || 'TBD'
  const winnerPair = row.winner_pair === 1 ? 1 : row.winner_pair === 2 ? 2 : null
  const closing = extra.closing
  const endedAtMs = row.finished_at ? +new Date(row.finished_at) : null
  const settled = settleFinishedWinProb(extra.history, winnerPair, Number.isFinite(endedAtMs) ? endedAtMs : null)
  return {
    id: row.id,
    pair1: { name: pn(row.p1a, row.p1b), player1Name: row.p1a?.name ?? 'TBD', player2Name: row.p1b?.name ?? 'TBD', gender: row.category === 'women' ? 'women' : 'men', serving: false },
    pair2: { name: pn(row.p2a, row.p2b), player1Name: row.p2a?.name ?? 'TBD', player2Name: row.p2b?.name ?? 'TBD', gender: row.category === 'women' ? 'women' : 'men', serving: false },
    tournament: t?.name ?? 'Unknown',
    court: row.court, round: row.round_canonical, tier: t?.level ?? null,
    status: 'finished', scheduledAt: row.scheduled_at,
    setScores: extra.sets.map((s) => ({ a: s.pair1_games, b: s.pair2_games, current: false })),
    gamePoints: null,
    winProb1: winnerPair != null ? settled.pair1Prob : (closing ? Number(closing.pair1_prob) : 0.5),
    fairOdds1: closing ? Number(closing.pair1_decimal_odds) : 0,
    fairOdds2: closing ? Number(closing.pair2_decimal_odds) : 0,
    movement15m: 0,
    confidence: closing?.coverage === 'live-coarse' ? 'low' : closing ? 'full' : 'med',
    anchorSource: null,
    lastUpdatedSeconds: 0,
    winProbSeries: settled.series,
    currentSetStartedAt: null,
    winnerPair,
    prematch: extra.prematchPair1Prob != null
      ? { pair1Prob: extra.prematchPair1Prob, correct: predictionCorrect(extra.prematchPair1Prob, winnerPair) }
      : null,
  }
}

// Bounded-concurrency map: runs `fn` over `items` with at most `limit` in flight,
// preserving input order in the result. Used so each match fetches its OWN data
// instead of sharing one global `.limit()` budget (which lets a busy subset
// starve other matches of their serving dot / win-prob history).
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const FETCH_CONCURRENCY = 8

const LIVE_SELECT =
  'match_id,pair1_prob,pair2_prob,pair1_decimal_odds,pair2_decimal_odds,anchor_source,coverage,computed_at,' +
  'matches!inner(status,court,round_canonical,category,tournament:tournaments(name,level),' +
  'p1a:players!matches_pair1_player1_id_fkey(id,name),p1b:players!matches_pair1_player2_id_fkey(id,name),' +
  'p2a:players!matches_pair2_player1_id_fkey(id,name),p2b:players!matches_pair2_player2_id_fkey(id,name))'

const FINISHED_SELECT =
  'id,status,winner_pair,court,round_canonical,category,scheduled_at,finished_at,tournament:tournaments(name,level),' +
  'p1a:players!matches_pair1_player1_id_fkey(id,name),p1b:players!matches_pair1_player2_id_fkey(id,name),' +
  'p2a:players!matches_pair2_player1_id_fkey(id,name),p2b:players!matches_pair2_player2_id_fkey(id,name)'

export async function getScoreboardSnapshot(dateIso: string): Promise<LiveOddsSnapshot> {
  const supabase = createServiceClient()
  const nowMs = Date.now()

  // 1) LIVE rows from match_live_odds (only currently-live matches)
  const { data: liveRows } = await supabase
    .from('match_live_odds')
    .select(LIVE_SELECT)
    .in('matches.status', ['live', 'on_court', 'break'])
    .returns<LiveOddsRow[]>()
  const live = liveRows ?? []
  const liveIds = live.map((r) => r.match_id)

  // FINISHED rows (today's terminal matches). Fetched up-front (only ids needed here)
  // so the pre-match prediction lookup can cover both live + finished in one query.
  const dayStart = `${dateIso}T00:00:00`, dayEnd = `${dateIso}T23:59:59`
  const { data: finRows } = await supabase.from('matches').select(FINISHED_SELECT)
    .gte('scheduled_at', dayStart).lte('scheduled_at', dayEnd)
    .in('status', ['finished', 'retired', 'walkover'])
    .returns<FinishedRow[]>()
  const finished = finRows ?? []
  const finIds = finished.map((r) => r.id)

  // Latest PRE-MATCH model_predictions.pair1_prob per match, for live + finished ids.
  // The model doesn't update during play, so the most recent row IS the pre-match value.
  // One combined query (ordered desc → first occurrence per id is the latest).
  const preMap = new Map<string, number>()
  const preIds = [...liveIds, ...finIds]
  if (preIds.length) {
    const { data: preRows } = await supabase
      .from('model_predictions')
      .select('match_id,pair1_prob,created_at')
      .in('match_id', preIds)
      .order('created_at', { ascending: false })
    for (const p of preRows ?? []) {
      if (!preMap.has(p.match_id)) preMap.set(p.match_id, Number(p.pair1_prob))
    }
  }

  // 2) Per-match extras: sets, current game, serving, snapshot history
  const extrasById = new Map<string, LiveExtras>()
  const livePointsById = new Map<string, PointRow[]>()
  if (liveIds.length) {
    // sets/games are tiny and bounded per match — batch them with `.in()`.
    const [{ data: sets }, { data: games }] = await Promise.all([
      supabase.from('sets').select('match_id,pair1_games,pair2_games,is_current,set_number').in('match_id', liveIds).order('set_number'),
      supabase.from('games').select('match_id,game_score,is_current').eq('is_current', true).in('match_id', liveIds),
    ])
    // serving + snapshot history are per-match fetches (bounded concurrency) so a
    // busy/early subset can't consume a shared `.limit()` budget and starve others.
    const servingById = new Map<string, string | null>()
    const histById = new Map<string, ProbPoint[]>()
    await mapLimit(liveIds, FETCH_CONCURRENCY, async (id) => {
      // Full snapshot history — `.limit(200)` at ~20s cadence was only ~67 minutes
      // and, ordered ascending, the *first* hour of a 2h+ match.
      const [{ data: pts }, snaps, points] = await Promise.all([
        supabase.from('match_points').select('server_player_id').eq('match_id', id).order('created_at', { ascending: false }).limit(1),
        loadAllSnapshots(supabase, id),
        loadMatchPoints(supabase, id),
      ])
      servingById.set(id, pts?.[0]?.server_player_id ?? null)
      histById.set(id, snaps.map((s) => ({ prob: s.pair1Prob, atMs: s.atMs })))
      livePointsById.set(id, points)
    })
    for (const id of liveIds) {
      const mSets = (sets ?? []).filter((s) => s.match_id === id)
      const curGame = (games ?? []).find((g) => g.match_id === id)
      extrasById.set(id, {
        sets: mSets.map((s) => ({ pair1_games: s.pair1_games, pair2_games: s.pair2_games, is_current: s.is_current })),
        gameScore: curGame?.game_score ?? null,
        servingPlayerId: servingById.get(id) ?? null,
        history: histById.get(id) ?? [],
        currentSetStartedAt: null,
        prematchPair1Prob: preMap.get(id) ?? null,
      })
    }
  }
  const liveMatches: Match[] = live.map((r) =>
    withPointScores(
      mapLiveRowToMatch(r, extrasById.get(r.match_id) ?? { sets: [], gameScore: null, servingPlayerId: null, history: [], currentSetStartedAt: null, prematchPair1Prob: preMap.get(r.match_id) ?? null }, nowMs),
      livePointsById.get(r.match_id) ?? [],
      r.matches ? pairIdsFromRow(r.matches) : undefined,
    ))

  // 3) SCHEDULED rows (today, not already live) from model_predictions
  const liveSet = new Set(liveIds)
  const dayRows = await getMatchOddsForDay(dateIso)
  const scheduled: Match[] = []
  const ids = new Set<string>()
  for (const r of dayRows) {
    if (liveSet.has(r.match.id)) continue
    for (const k of ['pair1_player1_id','pair1_player2_id','pair2_player1_id','pair2_player2_id'] as const) {
      const v = (r.match as unknown as Record<string, string | null>)[k]; if (v) ids.add(v)
    }
  }
  const nameById = new Map<string, string>()
  if (ids.size) {
    const { data: pl } = await supabase.from('players').select('id,name').in('id', [...ids])
    for (const p of pl ?? []) nameById.set(p.id, p.name)
  }
  for (const r of dayRows) {
    const mm = r.match as unknown as Record<string, string | null> & { id: string; status: string; category: string; court: string | null; round_canonical: string | null; round: string | null; scheduled_at: string; tournament?: { name: string | null } | { name: string | null }[] | null }
    if (liveSet.has(mm.id)) continue
    const nm = (id: string | null) => (id ? displayName(nameById.get(id) ?? null) : 'TBD')
    if (!isUpcomingStatus(mm.status)) continue
    const tourney = Array.isArray(mm.tournament) ? mm.tournament[0] : mm.tournament
    const pr = r.prediction as { pair1_prob: number; pair2_prob: number; pair1_decimal_odds: number; pair2_decimal_odds: number } | null
    scheduled.push({
      id: mm.id,
      pair1: { name: [nm(mm.pair1_player1_id), nm(mm.pair1_player2_id)].join(' / '), player1Name: nameById.get(mm.pair1_player1_id ?? '') ?? 'TBD', player2Name: nameById.get(mm.pair1_player2_id ?? '') ?? 'TBD', gender: mm.category === 'women' ? 'women' : 'men', serving: false },
      pair2: { name: [nm(mm.pair2_player1_id), nm(mm.pair2_player2_id)].join(' / '), player1Name: nameById.get(mm.pair2_player1_id ?? '') ?? 'TBD', player2Name: nameById.get(mm.pair2_player2_id ?? '') ?? 'TBD', gender: mm.category === 'women' ? 'women' : 'men', serving: false },
      tournament: tourney?.name ?? 'Unknown', court: mm.court, round: mm.round_canonical ?? mm.round, tier: null,
      status: 'scheduled', scheduledAt: mm.scheduled_at,
      setScores: [], gamePoints: null,
      winProb1: pr ? Number(pr.pair1_prob) : 0.5,
      fairOdds1: pr ? Number(pr.pair1_decimal_odds) : 0, fairOdds2: pr ? Number(pr.pair2_decimal_odds) : 0,
      movement15m: 0, confidence: 'med', anchorSource: null, lastUpdatedSeconds: 0,
      winProbSeries: [], currentSetStartedAt: null, winnerPair: null,
      // The scheduled row's model_predictions IS the pre-match prediction.
      prematch: pr ? { pair1Prob: Number(pr.pair1_prob), correct: null } : null,
    })
  }

  // 4) FINISHED rows — fetched up-front above; build per-match extras here.
  const finExtrasById = new Map<string, FinishedExtras>()
  const finPointsById = new Map<string, PointRow[]>()
  if (finIds.length) {
    // sets + closing odds are bounded per match — batch with `.in()`.
    const [{ data: finSets }, { data: finOdds }] = await Promise.all([
      supabase.from('sets').select('match_id,pair1_games,pair2_games,set_number').in('match_id', finIds).order('set_number'),
      supabase.from('match_live_odds').select('match_id,pair1_prob,pair1_decimal_odds,pair2_decimal_odds,coverage').in('match_id', finIds),
    ])
    // Snapshot history is per-match (bounded concurrency) so later finished matches
    // can't be truncated out of a shared `.limit()` budget on a busy day.
    const histById = new Map<string, Array<{ atMs: number; pair1Prob: number }>>()
    await mapLimit(finIds, FETCH_CONCURRENCY, async (id) => {
      const [snaps, points] = await Promise.all([
        loadAllSnapshots(supabase, id),
        loadMatchPoints(supabase, id),
      ])
      histById.set(id, snaps)
      finPointsById.set(id, points)
    })
    for (const id of finIds) {
      const mSets = (finSets ?? []).filter((s) => s.match_id === id)
      const odds = (finOdds ?? []).find((o) => o.match_id === id)
      const hist = histById.get(id) ?? []
      finExtrasById.set(id, {
        sets: mSets.map((s) => ({ pair1_games: s.pair1_games, pair2_games: s.pair2_games })),
        closing: odds
          ? { pair1_prob: Number(odds.pair1_prob), pair1_decimal_odds: Number(odds.pair1_decimal_odds), pair2_decimal_odds: Number(odds.pair2_decimal_odds), coverage: odds.coverage ?? null }
          : null,
        history: hist,
        prematchPair1Prob: preMap.get(id) ?? null,
      })
    }
  }
  const finishedMatches: Match[] = finished.map((r) =>
    withPointScores(
      mapFinishedRowToMatch(r, finExtrasById.get(r.id) ?? { sets: [], closing: null, history: [], prematchPair1Prob: preMap.get(r.id) ?? null }),
      finPointsById.get(r.id) ?? [],
      pairIdsFromRow(r),
    ))

  const matches = [...liveMatches, ...scheduled, ...finishedMatches]
  const kpis = {
    liveMatches: liveMatches.length,
    preMatchModeled: scheduled.length,
    biggestSwing: biggestSwing(liveMatches.map((m) => ({ movement15m: m.movement15m, label: `${m.pair1.name} vs ${m.pair2.name}` }))),
    lowCoverage: liveMatches.filter((m) => m.confidence === 'low').length,
  }
  return { matches, kpis, fetchedAt: new Date(nowMs).toISOString() }
}

async function loadAllSnapshots(
  supabase: ReturnType<typeof createServiceClient>,
  matchId: string,
): Promise<Array<{ atMs: number; pair1Prob: number }>> {
  const out: Array<{ pair1_prob: number | string; computed_at: string }> = []
  const batch = 1000
  let start = 0
  while (true) {
    const { data } = await supabase
      .from('match_live_odds_snapshots')
      .select('pair1_prob,computed_at')
      .eq('match_id', matchId)
      .order('computed_at', { ascending: true })
      .range(start, start + batch - 1)
    if (!data || data.length === 0) break
    out.push(...(data as Array<{ pair1_prob: number | string; computed_at: string }>))
    if (data.length < batch) break
    start += batch
  }
  return mapSnapshotRows(out)
}

async function loadMatchPoints(
  supabase: ReturnType<typeof createServiceClient>,
  matchId: string,
): Promise<PointRow[]> {
  const { data } = await supabase
    .from('match_points')
    .select('created_at, score_after, set_id, game_id, winner_pair, server_player_id, is_break_point, is_set_point, is_match_point, is_golden_point')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true })
    .limit(2000)
  return (data ?? []).map((p) => ({
    created_at: p.created_at as string,
    score_after: String(p.score_after ?? ''),
    set_id: String(p.set_id),
    game_id: String(p.game_id),
    winner_pair: p.winner_pair === 2 ? 2 : 1,
    server_player_id: (p.server_player_id as string | null) ?? null,
    is_break_point: Boolean(p.is_break_point),
    is_set_point: Boolean(p.is_set_point),
    is_match_point: Boolean(p.is_match_point),
    is_golden_point: Boolean(p.is_golden_point),
  }))
}

export function pairIdsFromRow(row: {
  p1a: { id: string } | null
  p1b: { id: string } | null
  p2a: { id: string } | null
  p2b: { id: string } | null
}): PairIds {
  return {
    pair1: new Set([row.p1a?.id, row.p1b?.id].filter((x): x is string => !!x)),
    pair2: new Set([row.p2a?.id, row.p2b?.id].filter((x): x is string => !!x)),
  }
}

export function withPointScores(match: Match, points: PointRow[], ids?: PairIds): Match {
  if (points.length === 0 || match.winProbSeries.length === 0) return match
  return {
    ...match,
    winProbSeries: attachScoreToSeries(match.winProbSeries, scoreTimeline(points, ids)),
  }
}

/** Single-match payload for the explorer drawer — same shape as a Today row. */
export async function getMatchScoreboard(matchId: string): Promise<Match | null> {
  const supabase = createServiceClient()
  const nowMs = Date.now()

  const { data: row } = await supabase
    .from('matches')
    .select(FINISHED_SELECT)
    .eq('id', matchId)
    .maybeSingle<FinishedRow>()
  if (!row) return null

  const [{ data: preRows }, history, { data: sets }, points] = await Promise.all([
    supabase
      .from('model_predictions')
      .select('pair1_prob')
      .eq('match_id', matchId)
      .order('created_at', { ascending: false })
      .limit(1),
    loadAllSnapshots(supabase, matchId),
    supabase
      .from('sets')
      .select('pair1_games,pair2_games,is_current,set_number')
      .eq('match_id', matchId)
      .order('set_number'),
    loadMatchPoints(supabase, matchId),
  ])
  const prematchPair1Prob = preRows?.[0] ? Number(preRows[0].pair1_prob) : null
  const kind = scoreboardKind(row.status)

  if (kind === 'live') {
    const { data: live } = await supabase
      .from('match_live_odds')
      .select(LIVE_SELECT)
      .eq('match_id', matchId)
      .maybeSingle<LiveOddsRow>()
    const { data: games } = await supabase
      .from('games')
      .select('game_score')
      .eq('match_id', matchId)
      .eq('is_current', true)
      .limit(1)
    const { data: pts } = await supabase
      .from('match_points')
      .select('server_player_id')
      .eq('match_id', matchId)
      .order('created_at', { ascending: false })
      .limit(1)
    const extras: LiveExtras = {
      sets: (sets ?? []).map((s) => ({
        pair1_games: s.pair1_games,
        pair2_games: s.pair2_games,
        is_current: Boolean(s.is_current),
      })),
      gameScore: games?.[0]?.game_score ?? null,
      servingPlayerId: pts?.[0]?.server_player_id ?? null,
      history: history.map((h) => ({ prob: h.pair1Prob, atMs: h.atMs })),
      currentSetStartedAt: null,
      prematchPair1Prob,
    }
    if (live) return withPointScores(mapLiveRowToMatch(live, extras, nowMs), points, pairIdsFromRow(row))
  }

  if (kind === 'finished' || history.length > 0) {
    const { data: odds } = await supabase
      .from('match_live_odds')
      .select('pair1_prob,pair1_decimal_odds,pair2_decimal_odds,coverage')
      .eq('match_id', matchId)
      .maybeSingle()
    return withPointScores(mapFinishedRowToMatch(row, {
      sets: (sets ?? []).map((s) => ({ pair1_games: s.pair1_games, pair2_games: s.pair2_games })),
      closing: odds
        ? {
            pair1_prob: Number(odds.pair1_prob),
            pair1_decimal_odds: Number(odds.pair1_decimal_odds),
            pair2_decimal_odds: Number(odds.pair2_decimal_odds),
            coverage: odds.coverage ?? null,
          }
        : null,
      history,
      prematchPair1Prob,
    }), points, pairIdsFromRow(row))
  }

  const pn = (a: { name: string | null } | null, b: { name: string | null } | null) =>
    [displayName(a?.name ?? null), displayName(b?.name ?? null)].filter((x) => x !== '—').join(' / ') || 'TBD'
  const t = Array.isArray(row.tournament) ? row.tournament[0] : row.tournament
  return {
    id: row.id,
    pair1: {
      name: pn(row.p1a, row.p1b),
      player1Name: row.p1a?.name ?? 'TBD',
      player2Name: row.p1b?.name ?? 'TBD',
      gender: row.category === 'women' ? 'women' : 'men',
      serving: false,
    },
    pair2: {
      name: pn(row.p2a, row.p2b),
      player1Name: row.p2a?.name ?? 'TBD',
      player2Name: row.p2b?.name ?? 'TBD',
      gender: row.category === 'women' ? 'women' : 'men',
      serving: false,
    },
    tournament: t?.name ?? 'Unknown',
    court: row.court,
    round: row.round_canonical,
    tier: t?.level ?? null,
    status: 'scheduled',
    scheduledAt: row.scheduled_at,
    setScores: [],
    gamePoints: null,
    winProb1: prematchPair1Prob ?? 0.5,
    fairOdds1: 0,
    fairOdds2: 0,
    movement15m: 0,
    confidence: 'med',
    anchorSource: null,
    lastUpdatedSeconds: 0,
    winProbSeries: [],
    currentSetStartedAt: null,
    winnerPair: null,
    prematch: prematchPair1Prob != null ? { pair1Prob: prematchPair1Prob, correct: null } : null,
  }
}
