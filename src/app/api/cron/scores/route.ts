// src/app/api/cron/scores/route.ts
// Score Agent — LIVE version
// Replaces stub data with real padelapi.org API calls

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const PADELAPI_BASE = 'https://padelapi.org/api'
const PADELAPI_TOKEN = process.env.PADELAPI_TOKEN!

// ── Rate limit state (in-memory, resets on cold start) ────────
let _rateLimitRemaining = 60  // Pro tier: 60 req/min
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

// ── Fetch wrapper with rate limit tracking ────────────────────
async function fetchFromApi(path: string): Promise<Response | null> {
  if (isRateLimited()) return null

  const res = await fetch(`${PADELAPI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${PADELAPI_TOKEN}` },
  })

  // Track rate limit headers on every response
  const remaining = res.headers.get('X-RateLimit-Remaining')
  const limit = res.headers.get('X-RateLimit-Limit')
  if (remaining !== null) _rateLimitRemaining = parseInt(remaining, 10)
  if (limit) console.log(`[Score Agent] Rate limit: ${remaining}/${limit} remaining`)

  // Handle 429 — back off for the duration specified
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

// ── Step 1: Fetch all live matches ────────────────────────────
async function fetchLiveMatches(): Promise<ApiMatch[]> {
  const res = await fetchFromApi('/live')
  if (!res) return []

  try {
    const data = await res.json()
    // API returns array directly or wrapped in { data: [...] }
    return Array.isArray(data) ? data : (data.data ?? [])
  } catch (e) {
    console.error('[Score Agent] Failed to parse /live response:', e)
    return []
  }
}

// ── Step 2: Fetch full point-by-point state for one match ─────
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

// ── Type definitions (mirrors padelapi.org response shape) ────
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
  connections?: { match: string }
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

// ── Normalize player names to handle accent variants ──────────
function normalizePlayerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')    // spaces/punctuation → hyphens
    .replace(/^-|-$/g, '')           // trim leading/trailing hyphens
}

// ── Upsert helpers ────────────────────────────────────────────
async function upsertPlayer(name: string, externalNumericId?: number): Promise<string | null> {
  const externalId = externalNumericId
    ? String(externalNumericId)
    : normalizePlayerName(name)

  const { data, error } = await supabase
    .from('players')
    .upsert(
      { external_id: externalId, name },
      { onConflict: 'external_id' }
    )
    .select('id')
    .single()

  if (error || !data) {
    console.error(`[Score Agent] Failed to upsert player ${name}:`, error)
    return null
  }
  return data.id
}

async function upsertTournament(
  match: ApiMatch
): Promise<string | null> {
  const tournament = match.tournament
  const name = tournament?.name ?? match.tournament_name ?? 'Unknown Tournament'
  const externalId = tournament?.id ? String(tournament.id) : normalizePlayerName(name)
  const level = tournament?.level ?? 'unknown'

  const { data, error } = await supabase
    .from('tournaments')
    .upsert(
      { external_id: externalId, name, level },
      { onConflict: 'external_id' }
    )
    .select('id')
    .single()

  if (error || !data) {
    console.error(`[Score Agent] Failed to upsert tournament ${name}:`, error)
    return null
  }
  return data.id
}

async function upsertMatch(
  match: ApiMatch,
  liveState: ApiMatchLive
): Promise<void> {
  const externalId = String(match.id)

  // Upsert tournament
  const tournamentId = await upsertTournament(match)

  // Upsert all 4 players
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

  // Upsert match row
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
        finished_at: liveState.status === 'finished' ? new Date().toISOString() : null,
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

  const matchDbId = matchRow.id

  // Upsert sets and games from live state
  for (const set of liveState.sets) {
    const isCurrentSet =
      set.set_score === null &&
      set.set_number === Math.max(...liveState.sets.map((s) => s.set_number))

    const { data: setRow, error: setError } = await supabase
      .from('sets')
      .upsert(
        {
          match_id: matchDbId,
          set_number: set.set_number,
          set_score: set.set_score,
          is_current: isCurrentSet,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'match_id, set_number' }
      )
      .select('id')
      .single()

    if (setError || !setRow) {
      console.error(`[Score Agent] Failed to upsert set ${set.set_number} for match ${externalId}:`, setError)
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

  console.log(`[Score Agent] ✓ Synced match ${externalId} (${liveState.status})`)
}

// ── Main handler ──────────────────────────────────────────────
export async function GET(request: Request) {
  // Auth check in production
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Bail early if rate limited
  if (isRateLimited()) {
    return Response.json(
      { skipped: true, reason: 'rate_limited', retryAfter: new Date(_retryAfter).toISOString() },
      { status: 200 }
    )
  }

  try {
    console.log('[Score Agent] Starting live sync...')

    // Step 1: Get all live matches
    const liveMatches = await fetchLiveMatches()

    if (liveMatches.length === 0) {
      console.log('[Score Agent] No live matches found.')
      return Response.json({ synced: 0, failed: 0, total: 0, mode: 'live' })
    }

    console.log(`[Score Agent] Found ${liveMatches.length} live match(es). Fetching live states...`)

    // Step 2: For each match, fetch full point-by-point state then upsert
    // Process sequentially to be kind to rate limits
    let succeeded = 0
    let failed = 0

    for (const match of liveMatches) {
      // Bail if we've hit rate limits mid-loop
      if (isRateLimited()) {
        console.warn(`[Score Agent] Rate limit hit mid-loop. Processed ${succeeded + failed}/${liveMatches.length} matches.`)
        break
      }

      const liveState = await fetchMatchLiveState(match.id)

      if (!liveState) {
        console.warn(`[Score Agent] Skipping match ${match.id} — could not fetch live state.`)
        failed++
        continue
      }

      try {
        await upsertMatch(match, liveState)
        succeeded++
      } catch (e) {
        console.error(`[Score Agent] Failed to upsert match ${match.id}:`, e)
        failed++
      }
    }

    console.log(`[Score Agent] Done. Synced: ${succeeded}, Failed: ${failed}, Total: ${liveMatches.length}`)

    return Response.json({
      synced: succeeded,
      failed,
      total: liveMatches.length,
      mode: 'live',
      rateLimitRemaining: _rateLimitRemaining,
    })
  } catch (error) {
    console.error('[Score Agent] Fatal error:', error)
    return Response.json(
      { error: 'Score agent failed', detail: String(error) },
      { status: 500 }
    )
  }
}
