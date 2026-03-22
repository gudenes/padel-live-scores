// src/app/api/cron/scores/route.ts
// Score Agent — REAL DATA from padelapi.org

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const PADELAPI = 'https://padelapi.org/api'

// ── Rate limit state (in-memory across requests in same instance) ────────────
let _rateLimitRemaining: number = 100
let _rateLimitResetAt: number = 0

function apiHeaders() {
  return {
    Authorization: `Bearer ${process.env.PADELAPI_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function updateRateLimitState(res: Response) {
  const remaining = res.headers.get('X-RateLimit-Remaining')
  const reset = res.headers.get('X-RateLimit-Reset')
  if (remaining !== null) _rateLimitRemaining = parseInt(remaining)
  if (reset !== null) _rateLimitResetAt = parseInt(reset) * 1000
  if (_rateLimitRemaining < 5) {
    console.warn(`[Score Agent] Rate limit low — ${_rateLimitRemaining} remaining, resets at ${new Date(_rateLimitResetAt).toISOString()}`)
  }
}

function isRateLimited(): boolean {
  if (_rateLimitRemaining <= 2 && Date.now() < _rateLimitResetAt) {
    console.warn(`[Score Agent] Skipping — rate limit exhausted until ${new Date(_rateLimitResetAt).toISOString()}`)
    return true
  }
  return false
}

async function fetchWithRateLimit(url: string, options: RequestInit & { next?: any }): Promise<Response> {
  const res = await fetch(url, options)
  updateRateLimitState(res)
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') ?? '60'
    console.warn(`[Score Agent] 429 received — backing off ${retryAfter}s`)
    _rateLimitRemaining = 0
    _rateLimitResetAt = Date.now() + parseInt(retryAfter) * 1000
    throw new Error(`Rate limited — retry after ${retryAfter}s`)
  }
  return res
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
  players: {
    team_1: ApiPlayer[]
    team_2: ApiPlayer[]
  }
  connections: {
    tournament: string
    live: string
  }
}

interface ApiLiveGame {
  game_number: number
  game_score: string
  points: string[]
}

interface ApiLiveSet {
  set_number: number
  set_score: string | null
  games: ApiLiveGame[]
}

interface ApiLiveMatch {
  id: number
  status: string
  coverage: string | null
  channel: string
  sets: ApiLiveSet[]
}

interface ApiPlayerDetail {
  id: number
  name: string
  short_name: string
  photo_url: string | null
  ranking: string
  nationality: string
}

// ── Fetch helpers ────────────────────────────────────────────

async function fetchLiveMatches(): Promise<ApiMatch[]> {
  const res = await fetchWithRateLimit(`${PADELAPI}/live`, {
    headers: apiHeaders(),
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`/live failed: ${res.status} ${res.statusText}`)
  const data = await res.json()
  return data.data ?? []
}

async function fetchMatchDetail(matchId: number): Promise<ApiMatch> {
  const res = await fetchWithRateLimit(`${PADELAPI}/matches/${matchId}`, {
    headers: apiHeaders(),
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`/matches/${matchId} failed: ${res.status}`)
  return res.json()
}

async function fetchLiveDetail(matchId: number): Promise<ApiLiveMatch> {
  const res = await fetchWithRateLimit(`${PADELAPI}/matches/${matchId}/live`, {
    headers: apiHeaders(),
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`/matches/${matchId}/live failed: ${res.status}`)
  return res.json()
}

async function fetchPlayerDetail(playerId: number): Promise<ApiPlayerDetail | null> {
  const res = await fetch(`${PADELAPI}/players/${playerId}`, {
    headers: apiHeaders(),
    next: { revalidate: 3600 },
  })
  if (!res.ok) return null
  return res.json()
}

interface ApiPlayerStats {
  matches_played: number
  matches_won: number
  win_percentage: string
}

async function fetchPlayerStats(playerId: number): Promise<ApiPlayerStats | null> {
  const res = await fetch(`${PADELAPI}/players/${playerId}/stats`, {
    headers: apiHeaders(),
    next: { revalidate: 3600 },
  })
  if (!res.ok) return null
  return res.json()
}

// ── Tournament ID from connection string ─────────────────────
function extractTournamentId(connectionUrl: string): string {
  return connectionUrl.split('/').pop() ?? connectionUrl
}

// ── Upsert helpers ───────────────────────────────────────────

async function upsertTournamentFromApi(tournamentExternalId: string): Promise<string | null> {
  // Fetch tournament details
  const res = await fetch(`${PADELAPI}/tournaments/${tournamentExternalId}`, {
    headers: apiHeaders(),
    next: { revalidate: 3600 },
  })

  let name = `Tournament ${tournamentExternalId}`
  let level = null

  if (res.ok) {
    const t = await res.json()
    name = t.name ?? name
    level = t.category ?? null
  }

  const { data, error } = await supabase
    .from('tournaments')
    .upsert(
      { external_id: tournamentExternalId, name, level },
      { onConflict: 'external_id' }
    )
    .select('id')
    .single()

  if (error || !data) {
    console.error(`Failed to upsert tournament ${tournamentExternalId}:`, error)
    return null
  }
  return data.id
}

async function upsertPlayer(apiPlayer: ApiPlayer): Promise<string | null> {
  const externalId = String(apiPlayer.id)

  // Fetch player detail + stats in parallel
  const [detail, stats] = await Promise.all([
    fetchPlayerDetail(apiPlayer.id),
    fetchPlayerStats(apiPlayer.id),
  ])

  const winRate = stats?.win_percentage
    ? Math.round(parseFloat(stats.win_percentage))
    : null

  const { data, error } = await supabase
    .from('players')
    .upsert(
      {
        external_id: externalId,
        name: apiPlayer.name,
        country: detail?.nationality ?? null,
        ranking: detail?.ranking ? parseInt(detail.ranking) : null,
        avatar_url: detail?.photo_url ?? null,
        win_rate: winRate,
        total_matches: stats?.matches_played ?? null,
      },
      { onConflict: 'external_id' }
    )
    .select('id')
    .single()

  if (error || !data) {
    console.error(`Failed to upsert player ${apiPlayer.name}:`, error)
    return null
  }
  return data.id
}

// ── Map round number to label ────────────────────────────────
function roundLabel(round: number, roundName: string): string {
  if (roundName) return roundName
  const map: Record<number, string> = {
    1: 'F', 2: 'SF', 4: 'QF', 8: 'R16', 16: 'R32', 32: 'R64',
  }
  return map[round] ?? `R${round}`
}

// ── Main upsert ──────────────────────────────────────────────

async function upsertMatch(liveMatch: ApiMatch) {
  const matchId = liveMatch.id
  const externalId = String(matchId)

  // The match came from /api/live so it IS live — use that status
  const apiStatus = 'live'

  // Fetch full match detail and live point data in parallel
  const [matchDetail, liveDetail] = await Promise.all([
    fetchMatchDetail(matchId),
    fetchLiveDetail(matchId),
  ])

  // Upsert tournament
  const tournamentExternalId = extractTournamentId(matchDetail.connections.tournament)
  const tournamentId = await upsertTournamentFromApi(tournamentExternalId)

  // Upsert all 4 players
  const t1 = matchDetail.players.team_1
  const t2 = matchDetail.players.team_2

  const [p1p1Id, p1p2Id, p2p1Id, p2p2Id] = await Promise.all([
    t1[0] ? upsertPlayer(t1[0]) : Promise.resolve(null),
    t1[1] ? upsertPlayer(t1[1]) : Promise.resolve(null),
    t2[0] ? upsertPlayer(t2[0]) : Promise.resolve(null),
    t2[1] ? upsertPlayer(t2[1]) : Promise.resolve(null),
  ])

  // Map status — matches from /api/live are always live
  const statusMap: Record<string, string> = {
    finished: 'finished',
    scheduled: 'scheduled',
    live: 'live',
    retired: 'finished',
  }

  // Upsert match row
  const { data: matchRow, error: matchError } = await supabase
    .from('matches')
    .upsert(
      {
        external_id: externalId,
        tournament_id: tournamentId,
        status: apiStatus,
        coverage: liveDetail.coverage,
        pusher_channel: liveDetail.channel,
        round: roundLabel(matchDetail.round, matchDetail.round_name),
        court: matchDetail.court,
        court_order: (matchDetail as any).court_order ?? null,
        pair1_player1_id: p1p1Id,
        pair1_player2_id: p1p2Id,
        pair2_player1_id: p2p1Id,
        pair2_player2_id: p2p2Id,
        started_at: matchDetail.started_time,
        finished_at: liveDetail.status === 'finished' ? new Date().toISOString() : null,
        raw_payload: liveDetail,
      },
      { onConflict: 'external_id' }
    )
    .select('id')
    .single()

  if (matchError || !matchRow) {
    console.error(`Failed to upsert match ${externalId}:`, matchError)
    return
  }

  const matchDbId = matchRow.id

  // Upsert sets and games
  const sets = liveDetail.sets ?? []
  const maxSetNumber = Math.max(...sets.map((s) => s.set_number))

  for (const set of sets) {
    const isCurrentSet = set.set_score === null && set.set_number === maxSetNumber

    const { data: setRow, error: setError } = await supabase
      .from('sets')
      .upsert(
        {
          match_id: matchDbId,
          set_number: set.set_number,
          set_score: set.set_score,
          is_current: isCurrentSet,
        },
        { onConflict: 'match_id, set_number', ignoreDuplicates: false }
      )
      .select('id')
      .single()

    if (setError || !setRow) {
      console.error(`Failed to upsert set ${set.set_number}:`, setError)
      continue
    }

    const games = set.games ?? []
    const maxGameNumber = games.length > 0 ? Math.max(...games.map((g) => g.game_number)) : 0

    for (const game of games) {
      const isCurrentGame = isCurrentSet && game.game_number === maxGameNumber
      const cleanPoints = game.points.filter((p) => p !== '0:0')

      const { error: gameError } = await supabase
        .from('games')
        .upsert(
          {
            set_id: setRow.id,
            match_id: matchDbId,
            game_number: game.game_number,
            game_score: game.game_score,
            points: cleanPoints,
            is_current: isCurrentGame,
          },
          { onConflict: 'set_id, game_number', ignoreDuplicates: false }
        )

      if (gameError) {
        console.error(`Failed to upsert game ${game.game_number}:`, gameError)
      }
    }

    // game_score is cumulative e.g. "0-3" — sort and take the last non-zero game
    const scoredGames = games
      .filter(g => g.game_score && g.game_score !== '0-0')
      .sort((a, b) => a.game_number - b.game_number)
    const lastScoredGame = scoredGames[scoredGames.length - 1]
    if (lastScoredGame?.game_score) {
      const [p1, p2] = lastScoredGame.game_score.split('-').map(Number)
      await supabase
        .from('sets')
        .update({ pair1_games: p1 ?? 0, pair2_games: p2 ?? 0 })
        .eq('id', setRow.id)
    }
  }

  console.log(`[Score Agent] ✓ Match ${externalId} — ${t1.map(p => p.name).join('/')} vs ${t2.map(p => p.name).join('/')}`)
}

// ── Main handler ─────────────────────────────────────────────

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    // Bail early if we know we're rate limited
    if (isRateLimited()) {
      return Response.json({
        skipped: true,
        message: `Rate limited — backing off until ${new Date(_rateLimitResetAt).toISOString()}`,
        remainingMs: _rateLimitResetAt - Date.now(),
      })
    }

    console.log(`[Score Agent] Starting sync — ${_rateLimitRemaining} API calls remaining`)

    const liveMatches = await fetchLiveMatches()
    console.log(`[Score Agent] Found ${liveMatches.length} live matches`)

    // Mark any DB-live matches that are no longer in /api/live as finished
    const liveIds = liveMatches.map(m => String(m.id))
    const { data: dbLiveMatches } = await supabase
      .from('matches')
      .select('id, external_id')
      .eq('status', 'live')

    if (dbLiveMatches) {
      const toFinish = dbLiveMatches.filter(m => !liveIds.includes(m.external_id))
      for (const m of toFinish) {
        console.log(`[Score Agent] Match ${m.external_id} no longer live — fetching final result`)
        try {
          // Fetch final match detail to get correct set scores
          const finalDetail = await fetchMatchDetail(parseInt(m.external_id))
          const winnerPair = finalDetail.winner === 'team_1' ? 1 : finalDetail.winner === 'team_2' ? 2 : null

          await supabase
            .from('matches')
            .update({
              status: 'finished',
              finished_at: new Date().toISOString(),
              winner_pair: winnerPair,
              duration: finalDetail.duration ?? null,
            })
            .eq('id', m.id)

          // Update set scores from final score array
          if (finalDetail.score && finalDetail.score.length > 0) {
            for (let i = 0; i < finalDetail.score.length; i++) {
              const s = finalDetail.score[i]
              const setScore = `${s.team_1}-${s.team_2}`
              const p1 = parseInt(s.team_1) || 0
              // Handle bracket format e.g. "6(1)"
              const p2match = s.team_2.match(/^(\d+)/)
              const p2 = p2match ? parseInt(p2match[1]) : 0
              await supabase
                .from('sets')
                .update({ set_score: setScore, pair1_games: p1, pair2_games: p2, is_current: false })
                .eq('match_id', m.id)
                .eq('set_number', i + 1)
            }
          }
          console.log(`[Score Agent] ✓ Match ${m.external_id} marked finished`)
        } catch (err) {
          console.error(`[Score Agent] Failed to finalize match ${m.external_id}:`, err)
          // Still mark as finished even if detail fetch fails
          await supabase
            .from('matches')
            .update({ status: 'finished', finished_at: new Date().toISOString() })
            .eq('id', m.id)
        }
      }
    }

    if (liveMatches.length === 0) {
      return Response.json({ synced: 0, message: 'No live matches at this time' })
    }

    const results = await Promise.allSettled(
      liveMatches.map((match) => upsertMatch(match))
    )

    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    const failed = results.filter((r) => r.status === 'rejected').length

    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[Score Agent] Match ${liveMatches[i].id} failed:`, r.reason)
      }
    })

    // Sync scheduled matches for active tournaments — picks up new matches like finals
    try {
      const { data: activeTournaments } = await supabase
        .from('tournaments')
        .select('id, external_id')
        .not('external_id', 'is', null)
        .or('ends_at.is.null,ends_at.gte.' + new Date().toISOString().slice(0, 10))

      for (const tournament of activeTournaments ?? []) {
        // Skip scheduled sync if rate limit is low
        if (isRateLimited()) {
          console.warn('[Score Agent] Skipping scheduled sync — rate limit low')
          break
        }
        const res = await fetchWithRateLimit(`${PADELAPI}/tournaments/${tournament.external_id}/matches?per_page=100`, {
          headers: apiHeaders(),
          next: { revalidate: 0 },
        })
        if (!res.ok) continue
        const data = await res.json()
        const matches: any[] = data.data ?? []

        for (const match of matches.filter((m: any) => m.status === 'scheduled')) {
          const externalId = String(match.id)
          // Only insert if not already in DB
          const { data: existing } = await supabase
            .from('matches')
            .select('id')
            .eq('external_id', externalId)
            .single()

          if (!existing) {
            console.log(`[Score Agent] New scheduled match found: ${externalId} — ${match.name}`)
            // Upsert players
            const t1 = match.players?.team_1 ?? []
            const t2 = match.players?.team_2 ?? []
            const [p1p1Id, p1p2Id, p2p1Id, p2p2Id] = await Promise.all([
              t1[0] ? upsertPlayer(t1[0]) : Promise.resolve(null),
              t1[1] ? upsertPlayer(t1[1]) : Promise.resolve(null),
              t2[0] ? upsertPlayer(t2[0]) : Promise.resolve(null),
              t2[1] ? upsertPlayer(t2[1]) : Promise.resolve(null),
            ])
            await supabase.from('matches').upsert({
              external_id: externalId,
              tournament_id: tournament.id,
              status: 'scheduled',
              round: match.round_name ?? null,
              court: match.court ?? null,
              court_order: match.court_order ?? null,
              category: match.category ?? null,
              schedule_label: match.schedule_label ?? null,
              pair1_player1_id: p1p1Id,
              pair1_player2_id: p1p2Id,
              pair2_player1_id: p2p1Id,
              pair2_player2_id: p2p2Id,
            }, { onConflict: 'external_id' })
          }
        }
      }
    } catch (err) {
      console.error('[Score Agent] Scheduled sync error:', err)
    }

    console.log(`[Score Agent] Done. Synced: ${succeeded}, Failed: ${failed}`)

    return Response.json({
      synced: succeeded,
      failed,
      total: liveMatches.length,
      mode: 'live',
    })
  } catch (error) {
    console.error('[Score Agent] Fatal error:', error)
    return Response.json(
      { error: 'Score agent failed', detail: String(error) },
      { status: 500 }
    )
  }
}
