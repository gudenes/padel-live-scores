// src/app/api/cron/sync/route.ts
// Weekly Sync Agent
// Keeps tournaments, players, and match results up to date
// Based on padelapi.org Data Synchronization guide:
// - Tournaments: weekly via /seasons/{id}/tournaments
// - Players: after each tournament week via /players/{id}
// - Matches: per tournament via /tournaments/{id}/matches
// - Handles 302 redirects (merged players/tournaments)
// - Handles 404 (deleted resources)
// - Handles 429 (rate limits)

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const PADELAPI_BASE = 'https://padelapi.org/api'
const PADELAPI_TOKEN = process.env.PADELAPI_TOKEN!

// ── Rate limit state ───────────────────────────────────────────
let _rateLimitRemaining = 60
let _retryAfter = 0

function isRateLimited(): boolean {
  if (_retryAfter > Date.now()) {
    console.warn(`[Sync] Rate limit backoff until ${new Date(_retryAfter).toISOString()}`)
    return true
  }
  if (_rateLimitRemaining <= 3) {
    console.warn(`[Sync] Rate limit nearly exhausted (${_rateLimitRemaining} remaining)`)
    return true
  }
  return false
}

// ── Fetch wrapper — handles rate limits + redirects ───────────
async function fetchFromApi(
  path: string,
  followRedirects = true
): Promise<{ res: Response; redirectedTo: string | null } | null> {
  if (isRateLimited()) return null

  const res = await fetch(`${PADELAPI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${PADELAPI_TOKEN}` },
    redirect: followRedirects ? 'follow' : 'manual',
  })

  const remaining = res.headers.get('X-RateLimit-Remaining')
  if (remaining !== null) _rateLimitRemaining = parseInt(remaining, 10)

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After')
    _retryAfter = Date.now() + (retryAfter ? parseInt(retryAfter, 10) : 60) * 1000
    console.error(`[Sync] 429 — backing off`)
    return null
  }

  // 302 redirect — capture the new location
  if (res.status === 302 || (res.redirected && res.url !== `${PADELAPI_BASE}${path}`)) {
    const newUrl = res.url
    const newPath = newUrl.replace(PADELAPI_BASE, '')
    console.log(`[Sync] 302 redirect: ${path} → ${newPath}`)
    return { res, redirectedTo: newPath }
  }

  if (res.status === 404) {
    console.warn(`[Sync] 404 for ${path} — resource no longer exists`)
    return null
  }

  if (!res.ok) {
    console.error(`[Sync] API error ${res.status} for ${path}`)
    return null
  }

  return { res, redirectedTo: null }
}

// ── Normalize player names ────────────────────────────────────
function normalizePlayerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ── Step 1: Sync seasons → get ALL active season IDs ──────────
// API: { data: [{ id, name, status, start_date, end_date, ... }] }
async function getActiveSeasonIds(): Promise<string[]> {
  const result = await fetchFromApi('/seasons?per_page=10')
  if (!result) return []

  try {
    const data = await result.res.json()
    const seasons = Array.isArray(data) ? data : (data.data ?? [])

    // Get all active seasons (can be multiple: Premier Padel + FIP Tour)
    const active = seasons.filter((s: any) => s.status === 'active')

    if (active.length === 0) {
      const fallback = seasons[0]
      if (!fallback?.id) return []
      console.log(`[Sync] No active seasons, using: ${fallback.id} (${fallback.name})`)
      return [String(fallback.id)]
    }

    const ids = active.map((s: any) => String(s.id))
    console.log(`[Sync] Active seasons: ${active.map((s: any) => s.id + ' (' + s.name + ')').join(', ')}`)
    return ids
  } catch (e) {
    console.error('[Sync] Failed to parse seasons:', e)
    return []
  }
}

// ── Step 2: Sync tournaments for a season ─────────────────────
// Uses list endpoint only — no per-tournament detail calls
// Redirect checks are deferred to reconciliation to save rate limits
async function syncTournaments(seasonId: string): Promise<string[]> {
  const result = await fetchFromApi(`/seasons/${seasonId}/tournaments?per_page=50`)
  if (!result) return []

  try {
    const data = await result.res.json()
    const tournaments = Array.isArray(data) ? data : (data.data ?? [])
    const syncedIds: string[] = []

    for (const t of tournaments) {
      if (!t.id) continue
      const externalId = String(t.id)

      // Upsert directly from list data — no extra API call needed
      // Schema: id, external_id, name, level, location, starts_at, ends_at,
      //         created_at, updated_at, country, timezone, status, season_id, url
      const { error } = await supabase
        .from('tournaments')
        .upsert(
          {
            external_id: externalId,
            name: t.name ?? 'Unknown',
            level: t.level ?? 'unknown',
            location: t.location ?? null,
            starts_at: t.start_date ?? null,
            ends_at: t.end_date ?? null,
            country: t.country ?? null,
            status: t.status ?? null,
            season_id: seasonId,
            url: t.url ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'external_id' }
        )

      if (error) {
        console.error(`[Sync] Failed to upsert tournament ${externalId}:`, error)
      } else {
        syncedIds.push(externalId)
      }
    }

    console.log(`[Sync] Tournaments synced: ${syncedIds.length}/${tournaments.length}`)
    return syncedIds
  } catch (e) {
    console.error('[Sync] Failed to parse tournaments:', e)
    return []
  }
}

// ── Step 3: Sync ALL matches for a tournament (all statuses, all pages) ──
// Handles pagination (94 matches = 7 pages at 15/page)
// Upserts scheduled matches even without players (draws happen later)
// Response shape: { id, status, category, round, round_name, index,
//   played_at, schedule_label, court, court_order, players: {team_1[], team_2[]} }
async function syncTournamentMatches(tournamentExternalId: string): Promise<number> {
  // Get the tournament DB id first
  const { data: tournamentRow } = await supabase
    .from('tournaments')
    .select('id')
    .eq('external_id', tournamentExternalId)
    .single()

  let synced = 0
  let page = 1
  let hasMore = true

  while (hasMore) {
    if (isRateLimited()) break

    const result = await fetchFromApi(
      `/tournaments/${tournamentExternalId}/matches?per_page=50&page=${page}`
    )
    if (!result) break

    try {
      const data = await result.res.json()
      const matches = Array.isArray(data) ? data : (data.data ?? [])
      const lastPage = data.meta?.last_page ?? 1
      hasMore = page < lastPage
      page++

      for (const match of matches) {
        if (isRateLimited()) break
        if (!match.id) continue

        const externalId = String(match.id)
        const status = match.status as string

        // Skip already complete finished matches to save writes
        const { data: existing } = await supabase
          .from('matches')
          .select('id, winner_pair, status')
          .eq('external_id', externalId)
          .single()

        if (existing?.winner_pair !== null && (existing?.status as string) === 'finished') continue

        // Parse winner from API format: "team_1" → 1, "team_2" → 2
        const winnerPair = match.winner === 'team_1' ? 1
          : match.winner === 'team_2' ? 2
          : null

        // Parse started_at from started_time
        const startedAt = match.started_time
          ? new Date(match.started_time).toISOString()
          : null

        // Upsert match
        const { data: matchRow, error: matchError } = await supabase
          .from('matches')
          .upsert(
            {
              external_id: externalId,
              tournament_id: tournamentRow?.id ?? null,
              status: status,
              winner_pair: winnerPair,
              round: match.round ?? null,
              round_name: match.round_name ?? null,
              court: match.court ?? null,
              court_order: match.court_order ?? null,
              schedule_label: match.schedule_label ?? null,
              category: match.category ?? null,
              played_at: match.played_at ?? null,
              started_at: startedAt,
              scheduled_at: match.played_at ?? null,
              duration: match.duration ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'external_id' }
          )
          .select('id')
          .single()

        if (matchError || !matchRow) continue

        // Upsert players for this match (team_1 = pair1, team_2 = pair2)
        const team1 = match.players?.team_1 ?? []
        const team2 = match.players?.team_2 ?? []

        const [p1p1, p1p2, p2p1, p2p2] = await Promise.all([
          team1[0] ? upsertPlayerFromDetail(team1[0]) : Promise.resolve(null),
          team1[1] ? upsertPlayerFromDetail(team1[1]) : Promise.resolve(null),
          team2[0] ? upsertPlayerFromDetail(team2[0]) : Promise.resolve(null),
          team2[1] ? upsertPlayerFromDetail(team2[1]) : Promise.resolve(null),
        ])

        // Update player IDs on the match if we got any
        if (p1p1 || p1p2 || p2p1 || p2p2) {
          await supabase
            .from('matches')
            .update({
              pair1_player1_id: p1p1,
              pair1_player2_id: p1p2,
              pair2_player1_id: p2p1,
              pair2_player2_id: p2p2,
            })
            .eq('id', matchRow.id)
        }

        // Upsert set scores for finished/retired matches
        // API returns: score: [{ team_1: "7", team_2: "6(7)" }, { team_1: "6", team_2: "0" }]
        if (winnerPair && match.score?.length > 0) {
          for (let i = 0; i < match.score.length; i++) {
            const s = match.score[i]
            const setScore = `${s.team_1}-${s.team_2}`
            await supabase
              .from('sets')
              .upsert(
                {
                  match_id: matchRow.id,
                  set_number: i + 1,
                  set_score: setScore,
                  is_current: false,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: 'match_id, set_number' }
              )
          }
          // Delete any orphan null sets
          await supabase
            .from('sets')
            .delete()
            .eq('match_id', matchRow.id)
            .is('set_score', null)
        }

        synced++
      }
    } catch (e) {
      console.error(`[Sync] Failed to parse matches page ${page} for tournament ${tournamentExternalId}:`, e)
      break
    }
  }

  console.log(`[Sync] Tournament ${tournamentExternalId}: ${synced} matches synced`)
  return synced
}

// Upsert a player from the tournament match detail format
// { id, name, side, connections: { pair } }
async function upsertPlayerFromDetail(player: any): Promise<string | null> {
  if (!player?.id) return null
  const { data, error } = await supabase
    .from('players')
    .upsert(
      {
        external_id: String(player.id),
        name: player.name ?? 'Unknown',
        side: player.side ?? null,
      },
      { onConflict: 'external_id' }
    )
    .select('id')
    .single()
  if (error || !data) return null
  return data.id
}

// ── Step 4: Sync player rankings + handle redirects ───────────
async function syncPlayers(): Promise<{ synced: number; redirects: number }> {
  // Get players that haven't been synced in the last 7 days
  const { data: players, error } = await supabase
    .from('players')
    .select('id, external_id, name')
    .or(
      `updated_at.is.null,updated_at.lt.${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()}`
    )
    .limit(30) // Max 30 per run to preserve rate limits

  if (error || !players) {
    console.error('[Sync] Failed to fetch players to sync:', error)
    return { synced: 0, redirects: 0 }
  }

  let synced = 0
  let redirects = 0

  for (const player of players) {
    if (isRateLimited()) break

    const result = await fetchFromApi(`/players/${player.external_id}`, false)
    if (!result) continue

    // Handle 302 redirect — player was merged into another
    if (result.redirectedTo) {
      const newExternalId = result.redirectedTo.split('/').pop()
      if (newExternalId) {
        console.log(`[Sync] Player ${player.external_id} (${player.name}) redirects to ${newExternalId}`)

        // Fetch the canonical player record
        const canonicalResult = await fetchFromApi(`/players/${newExternalId}`)
        if (!canonicalResult) continue

        try {
          const canonicalData = await canonicalResult.res.json()

          // Upsert the canonical player
          await supabase
            .from('players')
            .upsert(
              {
                external_id: newExternalId,
                name: canonicalData.name ?? player.name,
                country: canonicalData.country ?? null,
                ranking: canonicalData.ranking ?? null,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'external_id' }
            )

          // Update all match references from old ID to new ID
          const { data: canonicalRow } = await supabase
            .from('players')
            .select('id')
            .eq('external_id', newExternalId)
            .single()

          if (canonicalRow) {
            // Update all 4 pair columns in matches
            for (const col of ['pair1_player1_id', 'pair1_player2_id', 'pair2_player1_id', 'pair2_player2_id']) {
              await supabase
                .from('matches')
                .update({ [col]: canonicalRow.id })
                .eq(col, player.id)
            }
          }

          // Delete the old duplicate player record
          await supabase.from('players').delete().eq('id', player.id)

          redirects++
        } catch (e) {
          console.error(`[Sync] Failed to handle player redirect:`, e)
        }
      }
      continue
    }

    // Normal player update — refresh rankings, stats and gender
    try {
      const playerData = await result.res.json()

      await supabase
        .from('players')
        .update({
          name: playerData.name ?? player.name,
          country: playerData.country ?? null,
          ranking: playerData.ranking ?? null,
          win_rate: playerData.win_rate ?? null,
          total_matches: playerData.total_matches ?? null,
          avatar_url: playerData.avatar_url ?? null,
          gender: playerData.gender ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', player.id)

      synced++
    } catch (e) {
      console.error(`[Sync] Failed to update player ${player.external_id}:`, e)
    }
  }

  console.log(`[Sync] Players synced: ${synced}, redirects handled: ${redirects}`)
  return { synced, redirects }
}

// ── Main handler ───────────────────────────────────────────────
export async function GET(request: Request) {
  // Auth check
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Optional query params to scope the sync
  const url = new URL(request.url)
  const scope: string = url.searchParams.get('scope') ?? 'all'
  // ?scope=tournaments → only sync tournaments
  // ?scope=players     → only sync players
  // ?scope=matches     → only sync tournament matches
  // ?scope=all         → full sync (default)
  // ?tournament=123    → sync matches for a specific tournament

  const forceTournament = url.searchParams.get('tournament')

  // Always reset rate limit state at start of each run
  // Each Vercel invocation is a fresh instance — stale in-memory state
  // from a previous run should never block a new invocation
  _rateLimitRemaining = 60
  _retryAfter = 0

  try {
    console.log(`[Sync] Starting weekly sync (scope: ${scope})...`)
    const result: Record<string, any> = { scope, rateLimitRemaining: _rateLimitRemaining }

    // ── Specific tournament match sync ──
    if (forceTournament) {
      const matchesSynced = await syncTournamentMatches(forceTournament)
      return Response.json({ tournament: forceTournament, matchesSynced })
    }

    // ── Tournaments ──
    const syncScopes = scope.split(',') // allows comma-separated scopes
    if (syncScopes.includes('all') || syncScopes.includes('tournaments')) {
      const seasonIds = await getActiveSeasonIds()
      let totalTournamentsSynced = 0
      for (const seasonId of seasonIds) {
        if (isRateLimited()) break
        const synced = await syncTournaments(seasonId)
        totalTournamentsSynced += synced.length
      }
      result.tournaments = { synced: totalTournamentsSynced, seasons: seasonIds }
    }

    // ── Matches for active + recently completed tournaments ──
    // Syncs ALL matches for:
    //   - Currently active tournaments (scheduled upcoming matches + live + results)
    //   - Tournaments that ended in the last 14 days (fix any remaining broken results)
    // This is the single source of truth for scheduled matches AND reconciliation
    if (syncScopes.includes('all') || syncScopes.includes('matches')) {
      const today = new Date().toISOString().slice(0, 10)
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

      // Active tournaments: started and not yet ended
      const { data: activeTournaments } = await supabase
        .from('tournaments')
        .select('external_id, name')
        .lte('starts_at', today)
        .gte('ends_at', today)
        .limit(5)

      // Recently completed tournaments
      const { data: recentTournaments } = await supabase
        .from('tournaments')
        .select('external_id, name')
        .gte('ends_at', twoWeeksAgo)
        .lt('ends_at', today)
        .limit(3)

      const allTournaments = [
        ...(activeTournaments ?? []),
        ...(recentTournaments ?? []),
      ]

      // Deduplicate
      const seen = new Set<string>()
      const uniqueTournaments = allTournaments.filter(t => {
        if (seen.has(t.external_id)) return false
        seen.add(t.external_id)
        return true
      })

      console.log(`[Sync] Syncing matches for ${uniqueTournaments.length} tournament(s)`)

      let totalMatchesSynced = 0
      for (const t of uniqueTournaments) {
        if (isRateLimited()) break
        const count = await syncTournamentMatches(t.external_id)
        totalMatchesSynced += count
      }
      result.matches = { synced: totalMatchesSynced, tournaments: uniqueTournaments.map(t => t.external_id) }
    }

    // ── Players ──
    if (syncScopes.includes('all') || syncScopes.includes('players')) {
      const playerResult = await syncPlayers()
      result.players = playerResult
    }

    result.rateLimitRemaining = _rateLimitRemaining
    console.log('[Sync] Weekly sync complete:', result)
    return Response.json(result)
  } catch (error) {
    console.error('[Sync] Fatal error:', error)
    return Response.json(
      { error: 'Weekly sync failed', detail: String(error) },
      { status: 500 }
    )
  }
}
