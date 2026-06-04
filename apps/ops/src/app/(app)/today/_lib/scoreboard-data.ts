// apps/ops/src/app/(app)/today/_lib/scoreboard-data.ts
import { createServiceClient } from '@/lib/supabase'
import { getMatchOddsForDay } from '@/lib/odds-data'
import type { Match, MatchStatus, AnchorSource, LiveOddsSnapshot } from './types'
import { movement15m, capHistory, coverageToConfidence, biggestSwing, type ProbPoint } from './movement'
import { splitGameScore } from './score'

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

const statusOf = (s: string): MatchStatus =>
  s === 'break' ? 'break' : s === 'live' || s === 'on_court' ? 'live' : 'scheduled'

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
    winProbHistory: capHistory(extra.history.map((h) => h.prob), 30),
    currentSetStartedAt: extra.currentSetStartedAt,
  }
}

const LIVE_SELECT =
  'match_id,pair1_prob,pair2_prob,pair1_decimal_odds,pair2_decimal_odds,anchor_source,coverage,computed_at,' +
  'matches!inner(status,court,round_canonical,category,tournament:tournaments(name,level),' +
  'p1a:players!matches_pair1_player1_id_fkey(id,name),p1b:players!matches_pair1_player2_id_fkey(id,name),' +
  'p2a:players!matches_pair2_player1_id_fkey(id,name),p2b:players!matches_pair2_player2_id_fkey(id,name))'

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

  // 2) Per-match extras: sets, current game, serving, snapshot history
  const extrasById = new Map<string, LiveExtras>()
  if (liveIds.length) {
    const [{ data: sets }, { data: games }, { data: points }, { data: snaps }] = await Promise.all([
      supabase.from('sets').select('match_id,pair1_games,pair2_games,is_current,set_number').in('match_id', liveIds).order('set_number'),
      supabase.from('games').select('match_id,game_score,is_current').eq('is_current', true).in('match_id', liveIds),
      supabase.from('match_points').select('match_id,server_player_id,created_at').in('match_id', liveIds).order('created_at', { ascending: false }).limit(liveIds.length * 4),
      supabase.from('match_live_odds_snapshots').select('match_id,pair1_prob,computed_at').in('match_id', liveIds).order('computed_at', { ascending: true }).limit(liveIds.length * 40),
    ])
    for (const id of liveIds) {
      const mSets = (sets ?? []).filter((s) => s.match_id === id)
      const curGame = (games ?? []).find((g) => g.match_id === id)
      const latestPoint = (points ?? []).find((p) => p.match_id === id) // already desc-ordered
      const hist = (snaps ?? []).filter((s) => s.match_id === id)
        .map((s) => ({ prob: Number(s.pair1_prob), atMs: +new Date(s.computed_at) }))
      extrasById.set(id, {
        sets: mSets.map((s) => ({ pair1_games: s.pair1_games, pair2_games: s.pair2_games, is_current: s.is_current })),
        gameScore: curGame?.game_score ?? null,
        servingPlayerId: latestPoint?.server_player_id ?? null,
        history: hist,
        currentSetStartedAt: null,
      })
    }
  }
  const liveMatches: Match[] = live.map((r) =>
    mapLiveRowToMatch(r, extrasById.get(r.match_id) ?? { sets: [], gameScore: null, servingPlayerId: null, history: [], currentSetStartedAt: null }, nowMs))

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
      winProbHistory: [], currentSetStartedAt: null,
    })
  }

  const matches = [...liveMatches, ...scheduled]
  const kpis = {
    liveMatches: liveMatches.length,
    preMatchModeled: scheduled.length,
    biggestSwing: biggestSwing(liveMatches.map((m) => ({ movement15m: m.movement15m, label: `${m.pair1.name} vs ${m.pair2.name}` }))),
    lowCoverage: liveMatches.filter((m) => m.confidence === 'low').length,
  }
  return { matches, kpis, fetchedAt: new Date(nowMs).toISOString() }
}
