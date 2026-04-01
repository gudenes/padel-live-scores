// src/app/api/cron/scores/route.ts
// Score Agent — LIVE version with inference layer
// Key features:
// 1. Reconciliation correctly parses GET /api/matches/{id} response format
// 2. Set scores normalized at write time (7-6(7) not 7-67)
// 3. Finish transition immediately fetches authoritative final state
// 4. NEW: Final Score Inference — infers last set from point data when API returns null
// 5. score_source tracking on all set writes (api/inferred/live)

import { createClient } from '@supabase/supabase-js'
import { inferFinalScore, inferBatch, inferWinnerPair } from '@/lib/score-inference'
import { PlayerResolver } from '@/lib/player-resolver'
import { logOpsEvent } from '@/lib/ops-logger'

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

// Shape from GET /api/live — only basic fields, NO player data
// Players must be fetched separately from GET /api/matches/{id}
interface ApiMatch {
  id: number
  status: string
  coverage: string | null
  channel: string
  connections?: { match?: string }
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
  winner: 'team_1' | 'team_2' | null
  score: Array<{ team_1: string; team_2: string }>
  duration: string | null
  category: string | null
  round: number | null
  round_name: string | null
  index: number | null
  court: string | null
  court_order: number | null
  schedule_label: string | null
  played_at: string | null
  started_time: string | null
  players: {
    team_1: Array<{ id: number; name: string; side: string | null }>
    team_2: Array<{ id: number; name: string; side: string | null }>
  }
  connections?: Record<string, string>
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
// Note: padelapi.org /live only returns Premier Padel matches.
// Gold/Silver/Bronze are handled by the FIP standalone pipeline (cron:fip-scores).
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

// ── Compute pair game counts from a set ───────────────────────
// For a completed set: parse pair games from the normalized set_score
// For the current set (set_score null): the last game's game_score holds
// the games tally at the start of that game — e.g. "1-2" → pair1=1, pair2=2
function computePairGames(set: ApiSet): { pair1_games: number; pair2_games: number } {
  if (set.set_score !== null) {
    const normalized = normalizeSetScoreFromLive(set.set_score)
    if (normalized) {
      const parts = normalized.split('-')
      if (parts.length === 2) {
        const p1 = parseInt(parts[0])
        const p2 = parseInt(parts[1]) // parseInt stops at '(' so "6(6)" → 6
        if (!isNaN(p1) && !isNaN(p2)) return { pair1_games: p1, pair2_games: p2 }
      }
    }
  }
  // Current set: last game's game_score is the live games tally
  if (set.games && set.games.length > 0) {
    const lastGame = set.games.reduce(
      (max, g) => g.game_number > max.game_number ? g : max,
      set.games[0]
    )
    if (lastGame.game_score) {
      const parts = lastGame.game_score.split('-')
      if (parts.length === 2) {
        const p1 = parseInt(parts[0])
        const p2 = parseInt(parts[1])
        if (!isNaN(p1) && !isNaN(p2)) return { pair1_games: p1, pair2_games: p2 }
      }
    }
  }
  return { pair1_games: 0, pair2_games: 0 }
}

// ── Upsert helpers ─────────────────────────────────────────────
let _scoreResolver: PlayerResolver | null = null
async function getScoreResolver(): Promise<PlayerResolver> {
  if (!_scoreResolver) {
    _scoreResolver = new PlayerResolver(supabase)
    await _scoreResolver.load()
  }
  return _scoreResolver
}

async function upsertPlayer(name: string, externalNumericId?: number): Promise<string | null> {
  try {
    const resolver = await getScoreResolver()
    const { playerId } = await resolver.resolve({
      externalId: externalNumericId ? String(externalNumericId) : undefined,
      name,
    })
    return playerId
  } catch (err) {
    console.error(`[Score Agent] Failed to resolve player ${name}:`, err)
    return null
  }
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
    const { pair1_games, pair2_games } = computePairGames(set)

    const { data: setRow, error: setError } = await supabase
      .from('sets')
      .upsert(
        {
          match_id: matchDbId,
          set_number: set.set_number,
          set_score: normalizedScore,
          pair1_games,
          pair2_games,
          is_current: isCurrentSet,
          score_source: 'live' as const,  // ← NEW: tag source
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

      // Guard: don't overwrite with fewer points on finished matches
      let pointsToWrite = game.points ?? []
      if (isMatchFinished) {
        const { data: existing } = await supabase.from('games')
          .select('points')
          .eq('set_id', setDbId)
          .eq('game_number', game.game_number)
          .maybeSingle()
        const existingPoints = (existing?.points as string[]) ?? []
        if (existingPoints.length > pointsToWrite.length) {
          pointsToWrite = existingPoints
        }
      }

      const { error: gameError } = await supabase
        .from('games')
        .upsert(
          {
            set_id: setDbId,
            match_id: matchDbId,
            game_number: game.game_number,
            game_score: game.game_score,
            points: pointsToWrite,
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

// ── Refresh tournament draw after a match finishes ─────────────
// Called once per tournament per cron run when a match transitions to finished.
// Paginates through all pages of /tournaments/{id}/matches and updates player
// assignments on all scheduled matches — keeps the draw current without
// waiting for the 6h sync.
const _refreshedTournaments = new Set<string>()

async function refreshTournamentDraw(tournamentDbId: string): Promise<void> {
  if (_refreshedTournaments.has(tournamentDbId)) return // once per cron run
  _refreshedTournaments.add(tournamentDbId)

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('external_id')
    .eq('id', tournamentDbId)
    .single()
  if (!tournament) return

  let page = 1
  let hasMore = true
  let updated = 0

  while (hasMore) {
    if (isRateLimited()) break

    const res = await fetchFromApi(
      `/tournaments/${tournament.external_id}/matches?per_page=50&page=${page}`
    )
    if (!res) break

    let data: any
    try {
      data = await res.json()
    } catch {
      break
    }

    const matches: any[] = Array.isArray(data) ? data : (data.data ?? [])
    const lastPage: number = data.meta?.last_page ?? 1
    hasMore = page < lastPage
    page++

    for (const match of matches) {
      if (match.status !== 'scheduled' || !match.id) continue
      const team1: any[] = match.players?.team_1 ?? []
      const team2: any[] = match.players?.team_2 ?? []
      if (!team1.length && !team2.length) continue

      const [p1p1, p1p2, p2p1, p2p2] = await Promise.all([
        team1[0] ? upsertPlayer(team1[0].name, team1[0].id) : Promise.resolve(null),
        team1[1] ? upsertPlayer(team1[1].name, team1[1].id) : Promise.resolve(null),
        team2[0] ? upsertPlayer(team2[0].name, team2[0].id) : Promise.resolve(null),
        team2[1] ? upsertPlayer(team2[1].name, team2[1].id) : Promise.resolve(null),
      ])

      const patch: Record<string, any> = {
        schedule_label: match.schedule_label ?? null,
        court: match.court ?? null,
        court_order: match.court_order ?? null,
        updated_at: new Date().toISOString(),
      }
      if (p1p1) patch.pair1_player1_id = p1p1
      if (p1p2) patch.pair1_player2_id = p1p2
      if (p2p1) patch.pair2_player1_id = p2p1
      if (p2p2) patch.pair2_player2_id = p2p2

      await supabase.from('matches').update(patch).eq('external_id', String(match.id))
      updated++
    }
  }

  console.log(`[Score Agent] ✓ Draw refreshed for tournament ${tournament.external_id} — ${updated} scheduled matches updated (${page - 1} page(s) fetched)`)
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
  // started_time from detail endpoint fills the gap when match was never tracked as live
  const startedAt = detail.started_time
    ? new Date(detail.started_time).toISOString()
    : null

  await supabase
    .from('matches')
    .update({
      winner_pair: winnerPair,
      status: 'finished',
      finished_at: new Date().toISOString(),
      duration: detail.duration ?? null,
      started_at: startedAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', matchDbId)

  // Upsert set scores — use upsert not update so missing sets get created
  // Critical: if a set was never tracked during the match (e.g. relay was down),
  // the row won't exist and .update() would silently write nothing
  for (const set of sets) {
    const parts = set.set_score ? set.set_score.split('-') : []
    const p1 = parts.length === 2 ? parseInt(parts[0]) : NaN
    const p2 = parts.length === 2 ? parseInt(parts[1]) : NaN // parseInt stops at '('
    const pair1_games = !isNaN(p1) ? p1 : 0
    const pair2_games = !isNaN(p2) ? p2 : 0

    await supabase
      .from('sets')
      .upsert(
        {
          match_id: matchDbId,
          set_number: set.set_number,
          set_score: set.set_score,
          pair1_games,
          pair2_games,
          is_current: false,
          score_source: 'api' as const,  // ← NEW: authoritative data
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'match_id, set_number' }
      )
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
  // Restored to pre-regression behaviour (commit 78532f1)
  // 'ended' stays in DB as-is — reconciliation catches it when API confirms 'finished'
  // 'bye' never appears in /api/live, handled by tournament sync only
  const isFinished = liveState.status === 'finished' || liveState.status === 'retired'

  // Check if match already has player data in DB
  const { data: existing } = await supabase
    .from('matches')
    .select('id, pair1_player1_id, tournament_id, round, court, category')
    .eq('external_id', externalId)
    .single()

  // Only fetch detail for brand new matches (row doesn't exist yet)
  // For existing matches, tournament sync backfills players/metadata — skip detail to save rate limits
  // GET /api/matches/{id} costs 1 extra API call per match — too expensive for every 2-min cron
  let detail: ApiMatchDetail | null = null
  const needsDetail = !existing  // only fetch when match is brand new

  if (needsDetail && !isRateLimited()) {
    detail = await fetchMatchDetail(externalId)
  }

  // Get tournament ID from DB — prefer existing, otherwise look up from detail
  let tournamentId: string | null = existing?.tournament_id ?? null
  if (!tournamentId && detail) {
    const detailAny = detail as any
    const tournamentPath: string | null = detailAny?.connections?.tournament ?? null
    const tournamentExtId = tournamentPath?.replace('/api/tournaments/', '') ?? null
    if (tournamentExtId) {
      const { data: tRow } = await supabase
        .from('tournaments')
        .select('id')
        .eq('external_id', tournamentExtId)
        .single()
      if (tRow) tournamentId = tRow.id
    }
  }

  // Get player IDs from detail endpoint
  const team1 = detail?.players?.team_1 ?? []
  const team2 = detail?.players?.team_2 ?? []

  const [pair1Player1Id, pair1Player2Id, pair2Player1Id, pair2Player2Id] =
    existing?.pair1_player1_id
      ? [null, null, null, null] // already have players, skip
      : await Promise.all([
          team1[0] ? upsertPlayer(team1[0].name, team1[0].id) : Promise.resolve(null),
          team1[1] ? upsertPlayer(team1[1].name, team1[1].id) : Promise.resolve(null),
          team2[0] ? upsertPlayer(team2[0].name, team2[0].id) : Promise.resolve(null),
          team2[1] ? upsertPlayer(team2[1].name, team2[1].id) : Promise.resolve(null),
        ])

  const startedAt = detail?.started_time
    ? new Date(detail.started_time).toISOString()
    : (liveState.status === 'live' ? new Date().toISOString() : null)

  const { data: matchRow, error: matchError } = await supabase
    .from('matches')
    .upsert(
      {
        external_id: externalId,
        tournament_id: tournamentId,
        status: liveState.status,
        coverage: liveState.coverage,
        pusher_channel: liveState.channel,
        round: detail?.round ?? existing?.round ?? null,
        court: detail?.court ?? existing?.court ?? null,
        court_order: detail?.court_order ?? null,
        category: detail?.category ?? existing?.category ?? null,
        ...(pair1Player1Id ? { pair1_player1_id: pair1Player1Id } : {}),
        ...(pair1Player2Id ? { pair1_player2_id: pair1Player2Id } : {}),
        ...(pair2Player1Id ? { pair2_player1_id: pair2Player1Id } : {}),
        ...(pair2Player2Id ? { pair2_player2_id: pair2Player2Id } : {}),
        started_at: startedAt,
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
    const written = await writeFinalState(matchRow.id, externalId)

    // ── Refresh draw: update scheduled matches in this tournament ──
    if (written && existing?.tournament_id && !isRateLimited()) {
      await refreshTournamentDraw(existing.tournament_id)
    }

    // ── NEW: Inference fallback ──
    // If writeFinalState couldn't get the score (e.g. API returned null during
    // ended→finished transition), try to infer the last set from point data
    if (liveState.status === 'finished') {
      const { data: nullSet } = await supabase
        .from('sets')
        .select('id, set_score, score_source')
        .eq('match_id', matchRow.id)
        .is('set_score', null)
        .limit(1)
        .maybeSingle()

      if (nullSet && nullSet.score_source !== 'api') {
        const result = await inferFinalScore(supabase, matchRow.id)
        if (result.action === 'inferred') {
          console.log(`[Score Agent] Inference filled gap for match ${externalId}: ${result.detail}`)
        }
      }
    }
    // ── END inference fallback ──

    if (!written) {
      // Fallback: write what we have from /live
      await upsertSetsAndGames(matchRow.id, liveState.sets, true)
    }

    // Clean up is_current flags and compute coverage from actual data
    await cleanupMatchFinish(matchRow.id)
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
  inferred: number
}> {
  // Find matches that need repair:
  // 1. winner_pair is null (no winner recorded)
  // 2. OR: has winner but fewer scored sets than expected
  //    (catches 3-set matches missing their third set)
  // Use a raw SQL approach via RPC or two separate queries
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Query 1: missing winner
  const { data: missingWinner } = await supabase
    .from('matches')
    .select('id, external_id, finished_at')
    .in('status', ['finished', 'ended'])
    .is('winner_pair', null)
    .gte('finished_at', sevenDaysAgo)
    .order('finished_at', { ascending: false })
    .limit(8)

  // Query 2: has winner but incomplete sets (< 2 scored sets)
  // We can't easily join in PostgREST so we use a subquery approach:
  // find finished matches where sets with null set_score still exist
  const { data: incompleteSets } = await supabase
    .from('matches')
    .select('id, external_id, finished_at, sets!inner(set_score)')
    .in('status', ['finished'])
    .not('winner_pair', 'is', null)
    .gte('finished_at', sevenDaysAgo)
    .is('sets.set_score', null)
    .order('finished_at', { ascending: false })
    .limit(5)

  // Merge and deduplicate
  const seen = new Set<string>()
  const allMatches = [
    ...(missingWinner ?? []),
    ...(incompleteSets ?? []),
  ].filter(m => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })

  const incompleteMatches = allMatches
  const error = null

  if (error || !incompleteMatches || incompleteMatches.length === 0) {
    if (error) console.error('[Reconciliation] Query failed:', error)
    else console.log('[Reconciliation] No incomplete matches found ✓')
    return { checked: 0, repaired: 0, skipped: 0, inferred: 0 }
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
      await cleanupMatchFinish(match.id)
      console.log(`[Reconciliation] ✓ Repaired match ${match.external_id}`)
      repaired++
    } else {
      console.warn(`[Reconciliation] Could not repair match ${match.external_id} — no API data`)
      skipped++
    }
  }

  // ── NEW: Inference-based reconciliation ──
  // Catches finished matches where writeFinalState also failed (API returned null)
  // but point data exists in DB to derive the score
  const inferenceResults = await inferBatch(supabase, 7, 20)
  const inferredCount = inferenceResults.filter(r => r.action === 'inferred').length
  if (inferredCount > 0) {
    console.log(`[Reconciliation] Inference: fixed ${inferredCount} additional match(es)`)
  }
  // ── END inference reconciliation ──

  return { checked: incompleteMatches.length, repaired, skipped, inferred: inferredCount }
}

// ── Match finish cleanup: is_current flags + coverage ─────────
// Called after writeFinalState to ensure DB is fully consistent.
// 1. Clears is_current on ALL sets and games
// 2. Computes coverage from actual stored data vs expected game count
async function cleanupMatchFinish(matchDbId: string): Promise<void> {
  // Clear is_current on all sets and games for this match
  await Promise.all([
    supabase.from('sets').update({ is_current: false }).eq('match_id', matchDbId),
    supabase.from('games').update({ is_current: false }).eq('match_id', matchDbId),
  ])

  // Compute coverage from actual data
  const { data: sets } = await supabase
    .from('sets')
    .select('set_score, id')
    .eq('match_id', matchDbId)
    .not('set_score', 'is', null)

  if (!sets || sets.length === 0) {
    await supabase.from('matches').update({ coverage: null }).eq('id', matchDbId)
    return
  }

  let expectedGames = 0
  for (const set of sets) {
    if (!set.set_score) continue
    const parts = set.set_score.split('-')
    const p1 = parseInt(parts[0]) || 0
    const p2 = parseInt((parts[1]?.match(/^\d+/) ?? ['0'])[0]) || 0
    expectedGames += p1 + p2
  }

  // Count games that have point data
  const { count: gamesWithPoints } = await supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchDbId)
    .not('points', 'is', null)
    .neq('points', '{}')

  const actualGames = gamesWithPoints ?? 0

  let coverage: string | null
  if (expectedGames === 0) {
    coverage = null
  } else if (actualGames >= expectedGames) {
    coverage = 'full'
  } else if (actualGames > 0) {
    coverage = 'partial'
  } else {
    coverage = null
  }

  await supabase.from('matches').update({ coverage }).eq('id', matchDbId)
  console.log(`[Coverage] Match ${matchDbId}: ${actualGames}/${expectedGames} games tracked → ${coverage}`)

  // Infer winner if not set
  const { data: matchCheck } = await supabase
    .from('matches')
    .select('winner_pair')
    .eq('id', matchDbId)
    .single()
  if (matchCheck && !matchCheck.winner_pair) {
    await inferWinnerPair(supabase, matchDbId)
  }
}

// ── Stale match detector ──────────────────────────────────────
// Finds matches stuck as 'live' in DB that are no longer in the API live feed.
// This catches matches where the relay missed the 'finished' Pusher event.
async function detectStaleMatches(currentlyLiveFromApi: ApiMatch[]): Promise<{
  found: number; transitioned: number; failed: number
}> {
  const liveExternalIds = new Set(currentlyLiveFromApi.map(m => String(m.id)))

  // Find matches in DB with status='live' updated >15 min ago
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { data: staleMatches } = await supabase
    .from('matches')
    .select('id, external_id')
    .eq('status', 'live')
    .lt('updated_at', fifteenMinAgo)
    .limit(10)

  if (!staleMatches || staleMatches.length === 0) return { found: 0, transitioned: 0, failed: 0 }

  // Filter out any that are genuinely still live in the API
  const trulyStale = staleMatches.filter(m => !liveExternalIds.has(m.external_id))
  if (trulyStale.length === 0) return { found: staleMatches.length, transitioned: 0, failed: 0 }

  console.log(`[Stale Detector] Found ${trulyStale.length} stale live match(es)`)

  let transitioned = 0
  let failed = 0

  for (const match of trulyStale) {
    if (isRateLimited()) break

    // Try to get current state from the API
    const detail = await fetchMatchDetail(match.external_id)

    if (detail && (detail.status === 'finished' || detail.winner)) {
      // Match is finished — write final state
      const written = await writeFinalState(match.id, match.external_id)
      if (written) {
        // Clean up is_current flags and compute coverage
        await cleanupMatchFinish(match.id)
        console.log(`[Stale Detector] ✓ Transitioned stale match ${match.external_id} to finished`)
        transitioned++
      } else {
        failed++
      }
    } else if (detail) {
      // Match has a known status but not finished — update it
      await supabase
        .from('matches')
        .update({ status: detail.status ?? 'finished', updated_at: new Date().toISOString() })
        .eq('id', match.id)
      console.log(`[Stale Detector] Updated stale match ${match.external_id} to status=${detail.status}`)
      transitioned++
    } else {
      // Can't reach the API — mark as finished with what we have
      console.warn(`[Stale Detector] No API data for stale match ${match.external_id} — forcing finish`)
      await supabase
        .from('matches')
        .update({ status: 'finished', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', match.id)
      await cleanupMatchFinish(match.id)
      transitioned++
    }
  }

  return { found: trulyStale.length, transitioned, failed }
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
    const result = await logOpsEvent('cron:scores', async () => {
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

      // ── Step 1b: Detect stale "live" matches ────────────────────
      // Matches stuck as status='live' in DB but no longer in the API live feed.
      // This happens when the relay misses the 'finished' Pusher event.
      const staleResult = await detectStaleMatches(liveMatches)

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

      return {
        synced: syncSucceeded,
        failed: syncFailed,
        total: liveMatches.length,
        live_matches: liveMatches.length,
        stale: staleResult.found,
        api_requests: _rateLimitRemaining,
      }
    })

    return Response.json({
      ...result,
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
