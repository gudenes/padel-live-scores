// src/app/api/admin/seed-tournament/route.ts
// One-time seed: fetches ALL matches from a tournament and stores them
// Hit GET /api/admin/seed-tournament?tournament=727

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const PADELAPI = 'https://padelapi.org/api'

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

interface ApiPlayerDetail {
  id: number
  name: string
  photo_url: string | null
  ranking: string
  nationality: string
}

interface ApiPlayerStats {
  matches_played: number
  win_percentage: string
}

// ── Fetch helpers ─────────────────────────────────────────────

async function fetchAllTournamentMatches(tournamentId: string): Promise<ApiMatch[]> {
  const all: ApiMatch[] = []
  let page = 1

  while (true) {
    const res = await fetch(
      `${PADELAPI}/tournaments/${tournamentId}/matches?page=${page}&per_page=50`,
      { headers: apiHeaders() }
    )
    if (!res.ok) break
    const data = await res.json()
    const matches: ApiMatch[] = data.data ?? []
    all.push(...matches)
    if (!data.links?.next || matches.length === 0) break
    page++
  }

  return all
}

async function fetchLiveDetail(matchId: number): Promise<ApiLiveMatch | null> {
  const res = await fetch(`${PADELAPI}/matches/${matchId}/live`, {
    headers: apiHeaders(),
  })
  if (!res.ok) return null
  return res.json()
}

async function fetchTournamentDetail(tournamentId: string) {
  const res = await fetch(`${PADELAPI}/tournaments/${tournamentId}`, {
    headers: apiHeaders(),
  })
  if (!res.ok) return null
  return res.json()
}

async function fetchPlayerDetail(playerId: number): Promise<ApiPlayerDetail | null> {
  const res = await fetch(`${PADELAPI}/players/${playerId}`, {
    headers: apiHeaders(),
  })
  if (!res.ok) return null
  return res.json()
}

async function fetchPlayerStats(playerId: number): Promise<ApiPlayerStats | null> {
  const res = await fetch(`${PADELAPI}/players/${playerId}/stats`, {
    headers: apiHeaders(),
  })
  if (!res.ok) return null
  return res.json()
}

// ── Upsert helpers ────────────────────────────────────────────

// Player cache to avoid re-fetching same player multiple times
const playerCache = new Map<number, string>()

async function upsertPlayer(apiPlayer: ApiPlayer): Promise<string | null> {
  if (playerCache.has(apiPlayer.id)) return playerCache.get(apiPlayer.id)!

  const externalId = String(apiPlayer.id)
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

  playerCache.set(apiPlayer.id, data.id)
  return data.id
}

function roundLabel(round: number, roundName: string): string {
  if (roundName) return roundName
  const map: Record<number, string> = {
    1: 'F', 2: 'SF', 4: 'QF', 8: 'R16', 16: 'R32', 32: 'R64',
  }
  return map[round] ?? `R${round}`
}

function countryToTimezone(country?: string, location?: string): string {
  if (!country) return 'Europe/Madrid'
  // Special cases first (cities that differ from country default)
  if (location) {
    const loc = location.toLowerCase()
    if (loc.includes('cancún') || loc.includes('cancun')) return 'America/Cancun'
    if (loc.includes('buenos aires')) return 'America/Argentina/Buenos_Aires'
    if (loc.includes('doha') || loc.includes('qatar')) return 'Asia/Qatar'
  }
  const map: Record<string, string> = {
    ES: 'Europe/Madrid',
    AR: 'America/Argentina/Buenos_Aires',
    MX: 'America/Mexico_City',
    BR: 'America/Sao_Paulo',
    PT: 'Europe/Lisbon',
    FR: 'Europe/Paris',
    IT: 'Europe/Rome',
    BE: 'Europe/Brussels',
    NL: 'Europe/Amsterdam',
    DE: 'Europe/Berlin',
    GB: 'Europe/London',
    DK: 'Europe/Copenhagen',
    SE: 'Europe/Stockholm',
    QA: 'Asia/Qatar',
    AE: 'Asia/Dubai',
    US: 'America/New_York',
    AU: 'Australia/Sydney',
  }
  return map[country.toUpperCase()] ?? 'Europe/Madrid'
}

async function upsertMatch(match: ApiMatch, tournamentDbId: string): Promise<void> {
  const externalId = String(match.id)
  const t1 = match.players.team_1
  const t2 = match.players.team_2

  // Skip matches with no players yet (future draws not yet set)
  if (t1.length === 0 && t2.length === 0) {
    console.log(`[Seed] Skipping match ${externalId} — players not set yet`)
    return
  }

  // Upsert players
  const [p1p1Id, p1p2Id, p2p1Id, p2p2Id] = await Promise.all([
    t1[0] ? upsertPlayer(t1[0]) : Promise.resolve(null),
    t1[1] ? upsertPlayer(t1[1]) : Promise.resolve(null),
    t2[0] ? upsertPlayer(t2[0]) : Promise.resolve(null),
    t2[1] ? upsertPlayer(t2[1]) : Promise.resolve(null),
  ])

  // Map status
  const statusMap: Record<string, string> = {
    finished: 'finished',
    scheduled: 'scheduled',
    live: 'live',
    retired: 'finished',
  }
  const status = statusMap[match.status] ?? match.status

  // Try to get live/point data for finished matches
  let liveDetail: ApiLiveMatch | null = null
  if (status === 'finished' || status === 'live') {
    liveDetail = await fetchLiveDetail(match.id)
  }

  // Determine winner_pair from API winner field
  let winnerPair: number | null = null
  if (match.winner === 'team_1') winnerPair = 1
  else if (match.winner === 'team_2') winnerPair = 2

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
        court_order: (match as any).court_order ?? null,
        pair1_player1_id: p1p1Id,
        pair1_player2_id: p1p2Id,
        pair2_player1_id: p2p1Id,
        pair2_player2_id: p2p2Id,
        started_at: match.started_time,
        scheduled_at: match.played_at ?? null,
        finished_at: status === 'finished' ? match.started_time : null,
        winner_pair: winnerPair,
        duration: match.duration ?? null,
        schedule_label: match.schedule_label ?? null,
        category: match.category ?? null,
        raw_payload: liveDetail ?? match,
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

  // Upsert sets and games from live detail if available
  // Fall back to match.score (set scores only) when no live coverage
  const liveSets = liveDetail?.sets ?? []
  const hasLiveSets = liveSets.length > 0

  if (hasLiveSets) {
    const sets = liveSets
    const maxSetNumber = Math.max(...sets.map((s) => s.set_number))

    for (const set of sets) {
      const isCurrentSet = set.set_score === null && set.set_number === maxSetNumber && status === 'live'

      const { data: setRow, error: setError } = await supabase
        .from('sets')
        .upsert(
          {
            match_id: matchDbId,
            set_number: set.set_number,
            set_score: set.set_score,
            is_current: isCurrentSet,
          },
          { onConflict: 'match_id, set_number' }
        )
        .select('id')
        .single()

      if (setError || !setRow) continue

      const games = set.games ?? []
      const maxGameNumber = games.length > 0 ? Math.max(...games.map((g) => g.game_number)) : 0

      for (const game of games) {
        const isCurrentGame = isCurrentSet && game.game_number === maxGameNumber
        const cleanPoints = game.points.filter((p) => p !== '0:0')

        await supabase
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
            { onConflict: 'set_id, game_number' }
          )
      }
    }
  } else if (match.score && match.score.length > 0) {
    // No live coverage — use score array from match detail
    // Format: [{team_1: "7", team_2: "6(1)"}, {team_1: "6", team_2: "1"}]
    for (let i = 0; i < match.score.length; i++) {
      const s = match.score[i]
      // Store as "7-6(1)" format
      const setScore = `${s.team_1}-${s.team_2}`
      await supabase
        .from('sets')
        .upsert(
          {
            match_id: matchDbId,
            set_number: i + 1,
            set_score: setScore,
            is_current: false,
            pair1_games: parseInt(s.team_1) || 0,
            pair2_games: parseInt(s.team_2) || 0,
          },
          { onConflict: 'match_id, set_number', ignoreDuplicates: false }
        )
    }
  }

  const names = `${t1.map(p => p.name).join('/')} vs ${t2.map(p => p.name).join('/')}`
  console.log(`[Seed] ✓ ${roundLabel(match.round, match.round_name)} — ${names} (${status})`)
}

// ── Handler ───────────────────────────────────────────────────

export async function GET(request: Request) {
  const url = new URL(request.url)
  const tournamentId = url.searchParams.get('tournament') ?? '727'

  try {
    console.log(`[Seed] Starting tournament ${tournamentId} seed...`)

    // Fetch and upsert tournament
    const tournamentDetail = await fetchTournamentDetail(tournamentId)
    const tournamentName = tournamentDetail?.name ?? `Tournament ${tournamentId}`

    const { data: tRow, error: tError } = await supabase
      .from('tournaments')
      .upsert(
        {
          external_id: tournamentId,
          name: tournamentName,
          level: tournamentDetail?.category ?? null,
          starts_at: tournamentDetail?.start_date ?? null,
          ends_at: tournamentDetail?.end_date ?? null,
          country: tournamentDetail?.country ?? null,
          timezone: countryToTimezone(tournamentDetail?.country, tournamentDetail?.location),
        },
        { onConflict: 'external_id' }
      )
      .select('id')
      .single()

    if (tError || !tRow) {
      return Response.json({ error: 'Failed to upsert tournament', detail: tError }, { status: 500 })
    }

    const tournamentDbId = tRow.id
    console.log(`[Seed] Tournament: ${tournamentName} (DB id: ${tournamentDbId})`)

    // Fetch all matches
    const matches = await fetchAllTournamentMatches(tournamentId)
    console.log(`[Seed] Found ${matches.length} matches`)

    // Process sequentially to avoid rate limits
    let succeeded = 0
    let failed = 0

    for (const match of matches) {
      try {
        await upsertMatch(match, tournamentDbId)
        succeeded++
        // Small delay to stay within rate limits (60 req/min on Pro)
        await new Promise(r => setTimeout(r, 200))
      } catch (err) {
        console.error(`[Seed] Match ${match.id} failed:`, err)
        failed++
      }
    }

    console.log(`[Seed] Done. Succeeded: ${succeeded}, Failed: ${failed}`)

    return Response.json({
      tournament: tournamentName,
      total: matches.length,
      succeeded,
      failed,
    })
  } catch (error) {
    console.error('[Seed] Fatal error:', error)
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
