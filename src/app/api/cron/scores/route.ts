// src/app/api/cron/scores/route.ts
// Score Agent — LIVE version with fixed reconciliation
// Key fixes:
// 1. Reconciliation now correctly parses GET /api/matches/{id} response format
// 2. Set scores normalized at write time (7-6(7) not 7-67)
// 3. Finish transition immediately fetches authoritative final state
// 4. ApiMatchDetail type correctly models the match detail endpoint

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const PADELAPI_BASE = 'https://padelapi.org/api'
const PADELAPI_TOKEN = process.env.PADELAPI_TOKEN!

// ── Rate limit state ───────────────────────────────────────────
let _rateLimitRemaining = 60
let _rateLimitResetAt = 0
let _retryAfter = 0

function isRateLimited(): boolean {
  if (_retryAfter > Date.now()) {
    console.warn(`[Score Agent] Rate limit backoff active. Retry after ${new Date(_retryAfter).toISOString()}`)
    return true
  }
  if (_rateLimitRemaining <= 2) {
    console.warn(`[Score Agent] Rate limit nearly exhausted (${_rateLimitRemaining} remaining). Skipping run.`)
    return true
  }
  return false
}

// ── Fetch wrapper ──────────────────────────────────────────────
async function fetchFromApi(path: string): Promise<Response | null> {
  if (isRateLimited()) return null

  const res = await fetch(`${PADELAPI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${PADELAPI_TOKEN}` },
  })

  const remaining = res.headers.get('X-RateLimit-Remaining')
  const limit = res.headers.get('X-RateLimit-Limit')
  if (remaining !== null) _rateLimitRemaining = parseInt(remaining, 10)
  if (limit) console.log(`[Score Agent] Rate limit: ${remaining}/${limit} remaining`)

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After')
    const backoffSeconds = retryAfter ? parseInt(retryAfter, 10) : 60
    _retryAfter = Date.now() + backoffSeconds * 1000
    console.error(`[Score Agent] 429 received. Backing off for ${backoffSeconds}s.`)
    return null
  }

  if (!res.ok) {
    console.error(`[Score Agent] API error ${res.status} for ${path}`)
    return null
  }

  return res
}

// ── Types ──────────────────────────────────────────────────────

// Shape from GET /api/live and GET /api/matches/{id}/live
interface ApiMatch {
  id: number
  status: string
  coverage: string | null
  channel: string
  tournament?: { id: number; name: string; level?: string }
  tournament_name?: string
  round?: string
  court?: string
  court_order?: number
  scheduled_at?: string
  category?: string
  pair1?: { player1: { id: number; name: string }; player2: { id: number; name: string } }
  pair2?: { player1: { id: number; name: string }; player2: { id: number; name: string } }
}

interface ApiMatchLive {
  id: number
  status: string
  coverage: string | null
  channel: string
  sets: ApiSet[]
}

interface ApiSet {
  set_number: number
  set_score: string | null
  games: ApiGame[]
}

interface ApiGame {
  game_number: number
  game_score: string
  points: string[]
}

// Shape from GET /api/matches/{id} — DIFFERENT from /live
interface ApiMatchDetail {
  id: number
  status: string
  winner: 'team_1' | 'team_2' | null  // string, not int
  score: Array<{ team_1: string; team_2: string }> // set scores as array
  duration: string | null
  category: string | null
  round_name: string | null
  court: string | null
  court_order: number | null
  schedule_label: string | null
  played_at: string | null
  started_time: string | null
  players: {
    team_1: Array<{ id: number; name: string; side: string | null }>
    team_2: Array<{ id: number; name: string; side: string | null }>
  }
}

// ── Set score normalization ────────────────────────────────────
// Converts raw API formats to clean DB format
// Input from /live: "7-67" (tiebreak concatenated) → "7-6(7)"
// Input from /matches/{id}: team_1="7", team_2="6(7)" → "7-6(7)"
// Input from /live: "6-3" → "6-3" (unchanged)
function normalizeSetScoreFromLive(rawScore: string | null): string | null {
  if (!rawScore) return null

  const parts = rawScore.split('-')
  if (parts.length !== 2) return rawScore

  const p1str = parts[0]
  const p2str = parts[1]

  // Already clean format: "7-6(7)" or "6-3"
  if (p2str.includes('(') || p1str.includes('(')) return rawScore

  const p1 = parseInt(p1str)
  const p2 = parseInt(p2str)

  // Format: "7-67" — tiebreak appended to p2 (p1 won 7-6, tb=7)
  if (p2str.length >= 2 && p1 <= 7) {
    const realP2 = parseInt(p2str[0])
    const tb = parseInt(p2str.slice(1))
    if (realP2 >= 6 && realP2 <= 7 && !isNaN(tb)) {
      return `${p1}-${realP2}(${tb})`
    }
  }

  // Format: "67-7" — tiebreak appended to p1 (p2 won 6-7, tb=7)
  if (p1str.length >= 2 && p2 <= 7) {
    const realP1 = parseInt(p1str[0])
    const tb = parseInt(p1str.slice(1))
    if (realP1 >= 6 && realP1 <= 7 && !isNaN(tb)) {
      return `${realP1}(${tb})-${p2}`
    }
  }

  return rawScore
}

// Normalize from detail endpoint: team_1="7", team_2="6(7)" → "7-6(7)"
function normalizeSetScoreFromDetail(team1: string, team2: string): string {
  return `${team1}-${team2}`
}

// Parse winner string to int
function parseWinner(winner: string | null): number | null {
  if (winner === 'team_1') return 1
  if (winner === 'team_2') return 2
  return null
}

// ── Normalize player names ─────────────────────────────────────
function normalizePlayerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ── Fetch live matches ─────────────────────────────────────────
async function fetchLiveMatches(): Promise<ApiMatch[]> {
  const res = await fetchFromApi('/live')
  if (!res) return []
  try {
    const data = await res.json()
    return Array.isArray(data) ? data : (data.data ?? [])
  } catch (e) {
    console.error('[Score Agent] Failed to parse /live response:', e)
    return []
  }
}

// ── Fetch live match state ─────────────────────────────────────
async function fetchMatchLiveState(matchId: number): Promise<ApiMatchLive | null> {
  const res = await fetchFromApi(`/matches/${matchId}/live`)
  if (!res) return null
  try {
    return await res.json()
  } catch (e) {
    console.error(`[Score Agent] Failed to parse /matches/${matchId}/live:`, e)
    return null
  }
}

// ── Fetch match detail (authoritative final state) ─────────────
// Uses GET /api/matches/{id} — different shape from /live
async function fetchMatchDetail(matchId: string): Promise<ApiMatchDetail | null> {
  const res = await fetchFromApi(`/matches/${matchId}`)
  if (!res) return null
  try {
    return await res.json()
  } catch (e) {
    console.error(`[Score Agent] Failed to parse /matches/${matchId}:`, e)
    return null
  }
}

// ── Upsert helpers ─────────────────────────────────────────────
async function upsertPlayer(name: string, externalNumericId?: number): Promise<string | null> {
  const externalId = externalNumericId
    ? String(externalNumericId)
    : normalizePlayerName(name)

  const { data, error } = await supabase
    .from('players')
    .upsert({ external_id: externalId, name }, { onConflict: 'external_id' })
    .select('id')
    .single()

  if (error || !data) {
    console.error(`[Score Agent] Failed to upsert player ${name}:`, error)
    return null
  }
  return data.id
}

async function upsertTournament(match: ApiMatch): Promise<string | null> {
  const tournament = match.tournament
  const name = tournament?.name ?? match.tournament_name ?? 'Unknown Tournament'
  const externalId = tournament?.id ? String(tournament.id) : normalizePlayerName(name)
  const level = tournament?.level ?? 'unknown'

  const { data, error } = await supabase
    .from('tournaments')
    .upsert({ external_id: externalId, name, level }, { onConflict: 'external_id' })
    .select('id')
    .single()

  if (error || !data) {
    console.error(`[Score Agent] Failed to upsert tournament ${name}:`, error)
    return null
  }
  return data.id
}

async function upsertSetsAndGames(
  matchDbId: string,
  sets: ApiSet[],
  isMatchFinished: boolean
): Promise<void> {
  for (const set of sets) {
    if (isMatchFinished && !set.set_score) continue

    const isCurrentSet =
      !isMatchFinished &&
      set.set_score === null &&
      set.set_number === Math.max(...sets.map((s) => s.set_number))

    // ── Normalize set score at write time ──
    const normalizedScore = normalizeSetScoreFromLive(set.set_score)

    const { data: setRow, error: setError } = await supabase
      .from('sets')
      .upsert(
        {
          match_id: matchDbId,
          set_number: set.set_number,
          set_score: normalizedScore,
          is_current: isCurrentSet,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'match_id, set_number' }
      )
      .select('id')
      .single()

    if (setError || !setRow) {
      console.error(`[Score Agent] Failed to upsert set ${set.set_number}:`, setError)
      continue
    }

    const setDbId = setRow.id

    for (const game of set.games) {
      const isCurrentGame =
        isCurrentSet &&
        game.game_number === Math.max(...set.games.map((g) => g.game_number))

      const { error: gameError } = await supabase
        .from('games')
        .upsert(
          {
            set_id: setDbId,
            match_id: matchDbId,
            game_number: game.game_number,
            game_score: game.game_score,
            points: game.points,
            is_current: isCurrentGame,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'set_id, game_number' }
        )

      if (gameError) {
        console.error(`[Score Agent] Failed to upsert game ${game.game_number}:`, gameError)
      }
    }
  }

  if (isMatchFinished) {
    await supabase
      .from('sets')
      .delete()
      .eq('match_id', matchDbId)
      .is('set_score', null)
  }
}

// ── Write final authoritative state from detail endpoint ───────
// Called when a match finishes — uses GET /api/matches/{id} which
// returns the correct winner and clean set scores
async function writeFinalState(matchDbId: string, externalId: string): Promise<boolean> {
  const detail = await fetchMatchDetail(externalId)
  if (!detail) {
    console.warn(`[Score Agent] Could not fetch final state for match ${externalId}`)
    return false
  }

  // Parse winner: "team_1" → 1, "team_2" → 2
  const winnerPair = parseWinner(detail.winner)

  // Parse score array → normalized set scores
  const sets = (detail.score ?? []).map((s, idx) => ({
    set_number: idx + 1,
    set_score: normalizeSetScoreFromDetail(s.team_1, s.team_2),
  }))

  // Update match with authoritative final data
  await supabase
    .from('matches')
    .update({
      winner_pair: winnerPair,
      status: 'finished',
      finished_at: new Date().toISOString(),
      duration: detail.duration ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', matchDbId)

  // Update set scores with clean normalized values
  for (const set of sets) {
    await supabase
      .from('sets')
      .update({
        set_score: set.set_score,
        is_current: false,
        updated_at: new Date().toISOString(),
      })
      .eq('match_id', matchDbId)
      .eq('set_number', set.set_number)
  }

  // Delete any orphan null sets
  await supabase
    .from('sets')
    .delete()
    .eq('match_id', matchDbId)
    .is('set_score', null)

  console.log(`[Score Agent] ✓ Final state written for match ${externalId} — winner: pair ${winnerPair}, sets: ${sets.length}`)
  return true
}

async function upsertMatch(match: ApiMatch, liveState: ApiMatchLive): Promise<void> {
  const externalId = String(match.id)
  // ended = match over but score not yet confirmed (transitions to finished within minutes)
  // bye = no match played (no opponent)
  const isFinished = liveState.status === 'finished' || liveState.status === 'retired' || liveState.status === 'ended' || liveState.status === 'bye'

  const tournamentId = await upsertTournament(match)

  const p1p1 = match.pair1?.player1
  const p1p2 = match.pair1?.player2
  const p2p1 = match.pair2?.player1
  const p2p2 = match.pair2?.player2

  const [pair1Player1Id, pair1Player2Id, pair2Player1Id, pair2Player2Id] =
    await Promise.all([
      p1p1 ? upsertPlayer(p1p1.name, p1p1.id) : Promise.resolve(null),
      p1p2 ? upsertPlayer(p1p2.name, p1p2.id) : Promise.resolve(null),
      p2p1 ? upsertPlayer(p2p1.name, p2p1.id) : Promise.resolve(null),
      p2p2 ? upsertPlayer(p2p2.name, p2p2.id) : Promise.resolve(null),
    ])

  const { data: matchRow, error: matchError } = await supabase
    .from('matches')
    .upsert(
      {
        external_id: externalId,
        tournament_id: tournamentId,
        status: liveState.status,
        coverage: liveState.coverage,
        pusher_channel: liveState.channel,
        round: match.round ?? null,
        court: match.court ?? null,
        court_order: match.court_order ?? null,
        scheduled_at: match.scheduled_at ?? null,
        category: match.category ?? null,
        pair1_player1_id: pair1Player1Id,
        pair1_player2_id: pair1Player2Id,
        pair2_player1_id: pair2Player1Id,
        pair2_player2_id: pair2Player2Id,
        started_at: liveState.status === 'live' ? new Date().toISOString() : null,
        finished_at: isFinished ? new Date().toISOString() : null,
        raw_payload: liveState,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'external_id' }
    )
    .select('id')
    .single()

  if (matchError || !matchRow) {
    console.error(`[Score Agent] Failed to upsert match ${externalId}:`, matchError)
    return
  }

  if (isFinished) {
    // ── Finish transition: immediately fetch authoritative final state ──
    // GET /api/matches/{id} returns correct winner + clean set scores
    // Triggered on: finished, retired, ended (transitional), bye
    // 'ended' = match over but not yet confirmed — writeFinalState handles gracefully
    const written = await writeFinalState(matchRow.id, externalId)
    if (!written) {
      // Fallback: write what we have from /live
      await upsertSetsAndGames(matchRow.id, liveState.sets, true)
    }
  } else {
    await upsertSetsAndGames(matchRow.id, liveState.sets, false)
  }

  console.log(`[Score Agent] ✓ Synced match ${externalId} (${liveState.status})`)
}

// ── Reconciliation ─────────────────────────────────────────────
// Fixed: correctly parses GET /api/matches/{id} response format
// - winner: "team_1" → winner_pair: 1
// - score: [{team_1, team_2}] → normalized set scores
async function reconcileIncompleteMatches(): Promise<{
  checked: number
  repaired: number
  skipped: number
}> {
  const { data: incompleteMatches, error } = await supabase
    .from('matches')
    .select('id, external_id, finished_at')
    .in('status', ['finished', 'ended'])  // ended = transitional state before finished
    .is('winner_pair', null)
    .gte(
      'finished_at',
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    )
    .order('finished_at', { ascending: false })
    .limit(10)

  if (error || !incompleteMatches || incompleteMatches.length === 0) {
    if (error) console.error('[Reconciliation] Query failed:', error)
    else console.log('[Reconciliation] No incomplete matches found ✓')
    return { checked: 0, repaired: 0, skipped: 0 }
  }

  console.log(`[Reconciliation] Found ${incompleteMatches.length} incomplete match(es)`)

  let repaired = 0
  let skipped = 0

  for (const match of incompleteMatches) {
    if (isRateLimited()) {
      console.warn('[Reconciliation] Rate limited — stopping early')
      break
    }

    // ── Fixed: use writeFinalState which correctly parses the detail endpoint ──
    const written = await writeFinalState(match.id, match.external_id)

    if (written) {
      console.log(`[Reconciliation] ✓ Repaired match ${match.external_id}`)
      repaired++
    } else {
      console.warn(`[Reconciliation] Could not repair match ${match.external_id} — no API data`)
      skipped++
    }
  }

  return { checked: incompleteMatches.length, repaired, skipped }
}

// ── Main handler ───────────────────────────────────────────────
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (isRateLimited()) {
    return Response.json(
      { skipped: true, reason: 'rate_limited', retryAfter: new Date(_retryAfter).toISOString() },
      { status: 200 }
    )
  }

  try {
    console.log('[Score Agent] Starting live sync...')

    // ── Step 1: Sync live matches ──────────────────────────────
    const liveMatches = await fetchLiveMatches()
    let syncSucceeded = 0
    let syncFailed = 0

    if (liveMatches.length === 0) {
      console.log('[Score Agent] No live matches at this time.')
    } else {
      console.log(`[Score Agent] Found ${liveMatches.length} live match(es)`)

      for (const match of liveMatches) {
        if (isRateLimited()) break

        const liveState = await fetchMatchLiveState(match.id)
        if (!liveState) { syncFailed++; continue }

        try {
          await upsertMatch(match, liveState)
          syncSucceeded++
        } catch (e) {
          console.error(`[Score Agent] Failed to upsert match ${match.id}:`, e)
          syncFailed++
        }
      }
    }

    // ── Step 2: Reconcile incomplete finished matches ──────────
    const reconciliation = await reconcileIncompleteMatches()

    // ── Step 3: Ping Railway relay ────────────────────────────
    try {
      await fetch(
        `${process.env.RELAY_URL}/sync`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RELAY_SECRET}` },
        }
      )
      console.log('[Score Agent] Relay pinged successfully')
    } catch (e) {
      console.warn('[Score Agent] Relay ping failed (non-fatal):', e)
    }

    console.log(`[Score Agent] Done. Synced: ${syncSucceeded}, Failed: ${syncFailed}`)

    return Response.json({
      synced: syncSucceeded,
      failed: syncFailed,
      total: liveMatches.length,
      mode: 'live',
      rateLimitRemaining: _rateLimitRemaining,
      reconciliation,
    })
  } catch (error) {
    console.error('[Score Agent] Fatal error:', error)
    return Response.json(
      { error: 'Score agent failed', detail: String(error) },
      { status: 500 }
    )
  }
}
