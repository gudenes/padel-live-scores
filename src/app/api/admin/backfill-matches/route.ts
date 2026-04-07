// src/app/api/admin/backfill-matches/route.ts
// Batch backfill: fetches ALL historical matches + point-by-point for unsynced tournaments.
//
// Usage:
//   GET /api/admin/backfill-matches              — dry-run: shows which tournaments need syncing
//   GET /api/admin/backfill-matches?run=true      — start backfill (streams progress via SSE)
//   GET /api/admin/backfill-matches?run=true&season=4  — backfill only season 4
//   GET /api/admin/backfill-matches?run=true&tournament=727  — backfill single tournament
//   GET /api/admin/backfill-matches?run=true&levels=p1,p2,major,finals,fip_platinum,fip_gold,fip_silver
//                                                  — backfill only specific tier(s)
//   GET /api/admin/backfill-matches?run=true&skip_pbp=true   — skip point-by-point (faster)
//
// Special level: fip_silver matches "FIP SILVER" tournaments inside the fip_other DB level
// (since padelapi lumps Silver and Bronze under fip_other).

import { createClient } from '@supabase/supabase-js'
import { PlayerResolver } from '@/lib/player-resolver'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const PADELAPI = 'https://padelapi.org/api'
const API_DELAY_MS = 1100 // ~1 req/sec to respect 60 req/min limit
const DAILY_BUDGET = 2000 // 4-day plan: ~8000 total / 4 = 2000/day (well within 4000/day limit)

function apiHeaders() {
  return {
    Authorization: `Bearer ${process.env.PADELAPI_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

// ── Types ────────────────────────────────────────────────────

interface ApiPlayer {
  id: number
  name: string
  side: string | null
}

interface ApiMatch {
  id: number
  name: string | null
  category: string
  round: number
  round_name: string
  played_at: string
  court: string | null
  court_order: number | null
  status: string
  score: { team_1: string; team_2: string }[] | null
  winner: string | null
  started_time: string | null
  duration: string | null
  schedule_label: string | null
  players: { team_1: ApiPlayer[]; team_2: ApiPlayer[] }
  connections: { tournament: string; live: string }
}

interface ApiLiveMatch {
  id: number
  status: string
  coverage: string | null
  channel: string
  sets: {
    set_number: number
    set_score: string | null
    games: {
      game_number: number
      game_score: string
      points: string[]
    }[]
  }[]
}

// ── Helpers ──────────────────────────────────────────────────

let apiRequestCount = 0

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

class BudgetExhaustedError extends Error {
  constructor(count: number) {
    super(`Daily API budget exhausted (${count}/${DAILY_BUDGET} requests used). Resume tomorrow.`)
    this.name = 'BudgetExhaustedError'
  }
}

function trackRequest() {
  apiRequestCount++
  if (apiRequestCount >= DAILY_BUDGET) {
    throw new BudgetExhaustedError(apiRequestCount)
  }
}

function roundLabel(round: number, roundName: string): string {
  if (roundName) return roundName
  const map: Record<number, string> = {
    1: 'F', 2: 'SF', 4: 'QF', 8: 'R16', 16: 'R32', 32: 'R64',
  }
  return map[round] ?? `R${round}`
}

async function fetchAllTournamentMatches(tournamentId: string): Promise<ApiMatch[]> {
  const all: ApiMatch[] = []
  let page = 1
  while (true) {
    trackRequest()
    const res = await fetch(
      `${PADELAPI}/tournaments/${tournamentId}/matches?page=${page}&per_page=50`,
      { headers: apiHeaders() }
    )
    if (!res.ok) {
      console.error(`[Backfill] Tournament ${tournamentId} matches page ${page} failed: ${res.status}`)
      break
    }
    const data = await res.json()
    const matches: ApiMatch[] = data.data ?? []
    all.push(...matches)
    if (!data.links?.next || matches.length === 0) break
    page++
    await delay(API_DELAY_MS)
  }
  return all
}

async function fetchLiveDetail(matchId: number): Promise<ApiLiveMatch | null> {
  trackRequest()
  const res = await fetch(`${PADELAPI}/matches/${matchId}/live`, {
    headers: apiHeaders(),
  })
  if (!res.ok) return null
  return res.json()
}

// ── Match processing ─────────────────────────────────────────

async function resolvePlayer(
  resolver: PlayerResolver,
  apiPlayer: ApiPlayer,
  category: string | null
): Promise<string | null> {
  try {
    const result = await resolver.resolve({
      externalId: String(apiPlayer.id),
      name: apiPlayer.name,
      side: apiPlayer.side,
      category: category ?? undefined,
    })
    return result.playerId
  } catch (err) {
    console.error(`[Backfill] Failed to resolve player ${apiPlayer.name}:`, err)
    return null
  }
}

async function processMatch(
  match: ApiMatch,
  tournamentDbId: string,
  resolver: PlayerResolver,
  skipPbp: boolean
): Promise<{ ok: boolean; pbp: boolean }> {
  const externalId = String(match.id)
  const t1 = match.players.team_1
  const t2 = match.players.team_2

  // Skip matches with no players
  if (t1.length === 0 && t2.length === 0) return { ok: true, pbp: false }

  // Resolve players via PlayerResolver (no extra API calls)
  const [p1p1Id, p1p2Id, p2p1Id, p2p2Id] = await Promise.all([
    t1[0] ? resolvePlayer(resolver, t1[0], match.category) : Promise.resolve(null),
    t1[1] ? resolvePlayer(resolver, t1[1], match.category) : Promise.resolve(null),
    t2[0] ? resolvePlayer(resolver, t2[0], match.category) : Promise.resolve(null),
    t2[1] ? resolvePlayer(resolver, t2[1], match.category) : Promise.resolve(null),
  ])

  // Map status
  const statusMap: Record<string, string> = {
    finished: 'finished', scheduled: 'scheduled', live: 'live',
    retired: 'retired', walkover: 'walkover', bye: 'bye', ended: 'finished',
  }
  const status = statusMap[match.status] ?? match.status

  // Fetch point-by-point for finished matches
  let liveDetail: ApiLiveMatch | null = null
  let hasPbp = false
  if (!skipPbp && (status === 'finished' || status === 'retired')) {
    await delay(API_DELAY_MS)
    liveDetail = await fetchLiveDetail(match.id)
    hasPbp = (liveDetail?.sets?.length ?? 0) > 0
  }

  // Winner
  let winnerPair: number | null = null
  if (match.winner === 'team_1') winnerPair = 1
  else if (match.winner === 'team_2') winnerPair = 2

  // Retired pair
  let retiredPair: number | null = null
  if (match.status === 'retired') {
    // If team_1 won via retirement, team_2 retired
    retiredPair = winnerPair === 1 ? 2 : winnerPair === 2 ? 1 : null
  }

  // Upsert match
  const { data: matchRow, error: matchError } = await supabase
    .from('matches')
    .upsert(
      {
        external_id: externalId,
        tournament_id: tournamentDbId,
        status,
        coverage: liveDetail?.coverage ?? null,
        pusher_channel: liveDetail?.channel ?? `matches.${match.id}`,
        round: roundLabel(match.round, match.round_name),
        court: match.court,
        court_order: match.court_order ?? null,
        pair1_player1_id: p1p1Id,
        pair1_player2_id: p1p2Id,
        pair2_player1_id: p2p1Id,
        pair2_player2_id: p2p2Id,
        started_at: match.started_time ?? null,
        scheduled_at: match.played_at ?? null,
        finished_at: (status === 'finished' || status === 'retired')
          ? (match.started_time ?? match.played_at ?? null)
          : null,
        winner_pair: winnerPair,
        retired_pair: retiredPair,
        duration: match.duration ?? null,
        schedule_label: match.schedule_label ?? null,
        category: match.category ?? null,
        raw_payload: liveDetail ?? null,
      },
      { onConflict: 'external_id' }
    )
    .select('id')
    .single()

  if (matchError || !matchRow) {
    console.error(`[Backfill] Match ${externalId} upsert failed:`, matchError?.message)
    return { ok: false, pbp: false }
  }

  const matchDbId = matchRow.id

  // Store sets + games
  const liveSets = liveDetail?.sets ?? []
  if (liveSets.length > 0) {
    for (const set of liveSets) {
      // Parse set_score (e.g. "6-4") into pair1_games / pair2_games
      let pair1Games: number | null = null
      let pair2Games: number | null = null
      if (set.set_score) {
        const parts = set.set_score.split('-')
        if (parts.length === 2) {
          pair1Games = parseInt(parts[0]) || 0
          pair2Games = parseInt(parts[1]) || 0
        }
      }

      const { data: setRow, error: setError } = await supabase
        .from('sets')
        .upsert(
          {
            match_id: matchDbId,
            set_number: set.set_number,
            set_score: set.set_score,
            pair1_games: pair1Games,
            pair2_games: pair2Games,
            is_current: false,
            score_source: 'api',
          },
          { onConflict: 'match_id, set_number' }
        )
        .select('id')
        .single()

      if (setError || !setRow) continue

      for (const game of set.games ?? []) {
        const cleanPoints = game.points.filter(p => p !== '0:0')
        await supabase
          .from('games')
          .upsert(
            {
              set_id: setRow.id,
              match_id: matchDbId,
              game_number: game.game_number,
              game_score: game.game_score,
              points: cleanPoints,
              is_current: false,
            },
            { onConflict: 'set_id, game_number' }
          )
      }
    }
  } else if (match.score && match.score.length > 0) {
    // No live coverage — store set scores from match listing
    for (let i = 0; i < match.score.length; i++) {
      const s = match.score[i]
      await supabase
        .from('sets')
        .upsert(
          {
            match_id: matchDbId,
            set_number: i + 1,
            set_score: `${s.team_1}-${s.team_2}`,
            is_current: false,
            pair1_games: parseInt(s.team_1) || 0,
            pair2_games: parseInt(s.team_2) || 0,
            score_source: 'listing',
          },
          { onConflict: 'match_id, set_number' }
        )
    }
  }

  return { ok: true, pbp: hasPbp }
}

// ── Handler ──────────────────────────────────────────────────

export async function GET(request: Request) {
  const url = new URL(request.url)
  const run = url.searchParams.get('run') === 'true'
  const seasonFilter = url.searchParams.get('season')
  const tournamentFilter = url.searchParams.get('tournament')
  const levelsParam = url.searchParams.get('levels') ?? url.searchParams.get('level')
  const levelFilters = levelsParam
    ? levelsParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : null
  const skipPbp = url.searchParams.get('skip_pbp') === 'true'

  // Match a tournament against the level filters.
  // Special: 'fip_silver' matches `level=fip_other` AND name contains 'silver'
  function matchesLevelFilter(t: { level: string | null; name: string | null }): boolean {
    if (!levelFilters) return true
    const lvl = (t.level ?? '').toLowerCase()
    const name = (t.name ?? '').toLowerCase()
    for (const filter of levelFilters) {
      if (filter === 'fip_silver') {
        if (lvl === 'fip_other' && name.includes('silver')) return true
      } else if (filter === 'fip_bronze') {
        if (lvl === 'fip_other' && name.includes('bronze')) return true
      } else {
        if (lvl === filter) return true
      }
    }
    return false
  }

  // Fetch all tournaments
  const allTournaments: any[] = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('tournaments')
      .select('id, external_id, name, level, status, starts_at, season_external_id, source')
      .order('starts_at', { ascending: false })
      .range(offset, offset + 999)
    if (!data || data.length === 0) break
    allTournaments.push(...data)
    if (data.length < 1000) break
    offset += 1000
  }

  // Find tournaments that already have matches (paginate to avoid 1000-row default limit)
  const allTournamentIds: string[] = []
  let mOffset = 0
  while (true) {
    const { data: batch } = await supabase
      .from('matches')
      .select('tournament_id')
      .range(mOffset, mOffset + 999)
    if (!batch || batch.length === 0) break
    allTournamentIds.push(...batch.map(m => m.tournament_id))
    if (batch.length < 1000) break
    mOffset += 1000
  }
  const tourneysWithMatches = new Set(allTournamentIds)

  // Filter to finished tournaments that need syncing
  // Excludes source='fip' tournaments (FIP scraper) since their external_ids
  // (e.g. fip-fip-silver-...) aren't valid padelapi IDs.
  let targets = allTournaments.filter(t => {
    const isPast = new Date(t.starts_at) < new Date()
    if (!isPast) return false
    if (tournamentFilter) return t.external_id === tournamentFilter
    if (t.source === 'fip') return false
    if (!matchesLevelFilter(t)) return false
    if (seasonFilter) return String(t.season_external_id) === seasonFilter
    return !tourneysWithMatches.has(t.id)
  })

  // Dry run — just show what needs syncing
  if (!run) {
    const bySeason: Record<string, any[]> = {}
    const byLevel: Record<string, number> = {}
    for (const t of targets) {
      const key = `Season ${t.season_external_id}`
      if (!bySeason[key]) bySeason[key] = []
      bySeason[key].push({ name: t.name, level: t.level, external_id: t.external_id, hasMatches: tourneysWithMatches.has(t.id) })
      const lvlKey = t.level || 'unknown'
      byLevel[lvlKey] = (byLevel[lvlKey] || 0) + 1
    }
    return Response.json({
      mode: 'dry-run',
      totalTournaments: allTournaments.length,
      alreadySynced: tourneysWithMatches.size,
      needsSync: targets.length,
      ...(levelFilters ? { levelFilters } : {}),
      ...(seasonFilter ? { seasonFilter } : {}),
      ...(tournamentFilter ? { tournamentFilter } : {}),
      byLevel,
      tournaments: bySeason,
    })
  }

  // ── Streaming backfill via SSE ───────────────────────────────
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      // Reset request counter for this run
      apiRequestCount = 0

      try {
        // Initialize PlayerResolver
        const resolver = new PlayerResolver(supabase)
        await resolver.load()
        send({
          type: 'init',
          message: `Loaded player resolver. Processing ${targets.length} tournaments.`,
          dailyBudget: DAILY_BUDGET,
        })

        const totals = { tournaments: 0, matches: 0, pbp: 0, failed: 0, skipped: 0, apiRequests: 0 }

        for (let ti = 0; ti < targets.length; ti++) {
          const tournament = targets[ti]
          send({
            type: 'tournament_start',
            index: ti + 1,
            total: targets.length,
            name: tournament.name,
            level: tournament.level,
            external_id: tournament.external_id,
            apiRequests: apiRequestCount,
            budgetRemaining: DAILY_BUDGET - apiRequestCount,
          })

          // Fetch matches from API
          const apiMatches = await fetchAllTournamentMatches(tournament.external_id)

          if (apiMatches.length === 0) {
            send({ type: 'tournament_skip', name: tournament.name, reason: 'no matches from API' })
            totals.skipped++
            continue
          }

          let tMatches = 0, tPbp = 0, tFailed = 0

          for (let mi = 0; mi < apiMatches.length; mi++) {
            const match = apiMatches[mi]
            try {
              const result = await processMatch(match, tournament.id, resolver, skipPbp)
              if (result.ok) {
                tMatches++
                if (result.pbp) tPbp++
              } else {
                tFailed++
              }
            } catch (err) {
              if (err instanceof BudgetExhaustedError) throw err
              console.error(`[Backfill] Match ${match.id} error:`, err)
              tFailed++
            }

            // Progress update every 10 matches
            if ((mi + 1) % 10 === 0 || mi === apiMatches.length - 1) {
              send({
                type: 'progress',
                tournament: tournament.name,
                matchesProcessed: mi + 1,
                matchesTotal: apiMatches.length,
                apiRequests: apiRequestCount,
              })
            }
          }

          totals.tournaments++
          totals.matches += tMatches
          totals.pbp += tPbp
          totals.failed += tFailed

          send({
            type: 'tournament_done',
            name: tournament.name,
            matches: tMatches,
            pbp: tPbp,
            failed: tFailed,
            apiRequests: apiRequestCount,
          })
        }

        totals.apiRequests = apiRequestCount
        send({ type: 'done', totals })
      } catch (err) {
        if (err instanceof BudgetExhaustedError) {
          send({
            type: 'budget_stop',
            message: err.message,
            apiRequests: apiRequestCount,
            hint: 'Run the same command again tomorrow — already-synced tournaments will be skipped automatically.',
          })
        } else {
          send({ type: 'error', message: String(err) })
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
