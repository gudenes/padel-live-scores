// relay/index.js
// PadelNacho — Persistent Pusher Relay
// Always-on Node.js service deployed on Railway
// Holds open WebSocket connections to padelapi.org Pusher channels
// and writes every point update directly to Supabase
//
// NEW: Final Score Inference — when a match finishes, if the last set
// score is still null, infers it from the last recorded point data

'use strict'

const express = require('express')
const Pusher = require('pusher-js')
const { createClient } = require('@supabase/supabase-js')

// ── Config ────────────────────────────────────────────────────
const PUSHER_APP_KEY = process.env.PUSHER_APP_KEY || '0ffbefeb945e4e466065'
const PUSHER_CLUSTER = process.env.PUSHER_CLUSTER || 'eu'
const PUSHER_EVENT = 'App\\PadelApi\\Events\\MatchLiveUpdated'
const RELAY_SECRET = process.env.RELAY_SECRET
const PORT = process.env.PORT || 3001

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('[Relay] FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

// ── Supabase client ───────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ── Pusher client (single persistent connection) ──────────────
let pusherClient = null
const activeChannels = new Map() // channelName → Pusher channel object
const channelMatchIds = new Map() // channelName → externalId

function getPusherClient() {
  if (pusherClient && pusherClient.connection.state === 'connected') {
    return pusherClient
  }

  console.log('[Relay] Initializing Pusher connection...')

  // Enable logging in dev
  if (process.env.NODE_ENV !== 'production') {
    Pusher.logToConsole = false
  }

  pusherClient = new Pusher(PUSHER_APP_KEY, {
    cluster: PUSHER_CLUSTER,
  })

  pusherClient.connection.bind('connected', () => {
    console.log('[Relay] ✓ Pusher connected')
  })

  pusherClient.connection.bind('disconnected', () => {
    console.warn('[Relay] Pusher disconnected — reconnecting automatically...')
  })

  pusherClient.connection.bind('error', (err) => {
    console.error('[Relay] Pusher connection error:', err)
  })

  pusherClient.connection.bind('state_change', ({ previous, current }) => {
    console.log(`[Relay] Pusher state: ${previous} → ${current}`)
    // If we reconnect, re-seed all active channels from the live state
    if (previous === 'disconnected' && current === 'connected') {
      console.log('[Relay] Reconnected — re-seeding all active channels')
      reseedAllChannels()
    }
  })

  return pusherClient
}

// ── Score Inference — pure functions ──────────────────────────
// Duplicated from src/lib/score-inference.ts since the relay
// is a standalone Node.js service that can't import from Next.js

const STANDARD_POINTS = { '0': 0, '15': 1, '30': 2, '40': 3, 'A': 4 }

function determineGameWinner(points, isTiebreak) {
  const realPoints = points.filter((p) => p !== '0:0')
  if (realPoints.length === 0) return null

  const lastPoint = realPoints[realPoints.length - 1]
  const parts = lastPoint.split(':')
  if (parts.length !== 2) return null

  const [raw1, raw2] = parts

  if (isTiebreak) {
    const val1 = parseInt(raw1, 10)
    const val2 = parseInt(raw2, 10)
    if (isNaN(val1) || isNaN(val2) || val1 === val2) return null
    return val1 > val2 ? 1 : 2
  }

  const val1 = STANDARD_POINTS[raw1]
  const val2 = STANDARD_POINTS[raw2]

  if (val1 === undefined || val2 === undefined) {
    const num1 = parseInt(raw1, 10)
    const num2 = parseInt(raw2, 10)
    if (!isNaN(num1) && !isNaN(num2) && num1 !== num2) {
      return num1 > num2 ? 1 : 2
    }
    return null
  }

  if (val1 === val2) return null
  return val1 > val2 ? 1 : 2
}

function parseGameScoreStr(gameScore) {
  if (!gameScore) return null
  const cleaned = gameScore.replace(/\s/g, '')
  const parts = cleaned.split('-')
  if (parts.length !== 2) return null
  const team1 = parseInt(parts[0], 10)
  const team2 = parseInt(parts[1], 10)
  if (isNaN(team1) || isNaN(team2)) return null
  return { team1, team2 }
}

function calculateSetScore(team1Games, team2Games, gameWinner) {
  const newTeam1 = gameWinner === 1 ? team1Games + 1 : team1Games
  const newTeam2 = gameWinner === 2 ? team2Games + 1 : team2Games
  const winnerGames = Math.max(newTeam1, newTeam2)
  const loserGames = Math.min(newTeam1, newTeam2)
  if (winnerGames < 6 || winnerGames > 7) return null
  if (winnerGames === 6 && loserGames > 4) return null
  if (winnerGames === 7 && loserGames !== 5 && loserGames !== 6) return null
  return `${newTeam1}-${newTeam2}`
}

/**
 * Try to infer the final set score for a finished match.
 * Only updates existing rows — never creates new ones.
 */
async function tryInferFinalScore(matchDbId) {
  try {
    // Find the incomplete set
    const { data: incompleteSet } = await supabase
      .from('sets')
      .select('id, set_number, set_score, score_source')
      .eq('match_id', matchDbId)
      .is('set_score', null)
      .order('set_number', { ascending: false })
      .limit(1)
      .single()

    if (!incompleteSet || incompleteSet.score_source === 'api') return

    // Get the last game in that set
    const { data: lastGame } = await supabase
      .from('games')
      .select('id, game_number, game_score, points')
      .eq('set_id', incompleteSet.id)
      .order('game_number', { ascending: false })
      .limit(1)
      .single()

    if (!lastGame || !lastGame.points || lastGame.points.length === 0) return

    const parsed = parseGameScoreStr(lastGame.game_score)
    if (!parsed) return

    const isTiebreak = parsed.team1 === 6 && parsed.team2 === 6
    const gameWinner = determineGameWinner(lastGame.points, isTiebreak)
    if (!gameWinner) return

    const newScore = calculateSetScore(parsed.team1, parsed.team2, gameWinner)
    if (!newScore) return

    // Write inferred score — UPDATE only, never INSERT
    await supabase
      .from('sets')
      .update({
        set_score: newScore,
        is_current: false,
        score_source: 'inferred',
        updated_at: new Date().toISOString(),
      })
      .eq('id', incompleteSet.id)
      .eq('match_id', matchDbId)

    await supabase
      .from('games')
      .update({ is_current: false })
      .eq('id', lastGame.id)

    console.log(
      `[Relay-Inference] Match ${matchDbId}: inferred set ${incompleteSet.set_number} = ${newScore}`
    )
  } catch (err) {
    console.error(`[Relay-Inference] Error for match ${matchDbId}:`, err.message)
  }
}

// ── Match finish cleanup: clear is_current + compute coverage ─
async function cleanupMatchFinish(matchDbId) {
  // Clear is_current on all sets and games
  await Promise.all([
    supabase.from('sets').update({ is_current: false }).eq('match_id', matchDbId),
    supabase.from('games').update({ is_current: false }).eq('match_id', matchDbId),
  ])

  // Compute coverage from actual stored data
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

  const { count: gamesWithPoints } = await supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchDbId)
    .not('points', 'is', null)
    .neq('points', '{}')

  const actualGames = gamesWithPoints ?? 0

  let coverage = null
  if (expectedGames > 0 && actualGames >= expectedGames) coverage = 'full'
  else if (actualGames > 0) coverage = 'partial'

  await supabase.from('matches').update({ coverage }).eq('id', matchDbId)
  console.log(`[Coverage] Match ${matchDbId}: ${actualGames}/${expectedGames} games → ${coverage}`)

  // Infer winner_pair if not set — derive from set scores
  const { data: matchCheck } = await supabase
    .from('matches')
    .select('winner_pair')
    .eq('id', matchDbId)
    .single()
  if (matchCheck && !matchCheck.winner_pair) {
    const { data: allSets } = await supabase
      .from('sets')
      .select('pair1_games, pair2_games')
      .eq('match_id', matchDbId)
      .not('set_score', 'is', null)
    if (allSets && allSets.length >= 2) {
      let p1Sets = 0, p2Sets = 0
      for (const s of allSets) {
        if ((s.pair1_games ?? 0) > (s.pair2_games ?? 0)) p1Sets++
        else if ((s.pair2_games ?? 0) > (s.pair1_games ?? 0)) p2Sets++
      }
      const winner = p1Sets >= 2 ? 1 : p2Sets >= 2 ? 2 : null
      if (winner) {
        await supabase.from('matches')
          .update({ winner_pair: winner, updated_at: new Date().toISOString() })
          .eq('id', matchDbId)
          .is('winner_pair', null)
        console.log(`[Relay] Inferred winner = pair ${winner} (${p1Sets}-${p2Sets} sets)`)
      }
    }
  }
}

// ── Write live state to Supabase ──────────────────────────────
async function handleLiveUpdate(data) {
  const externalId = String(data.id)

  try {
    // 1. Find the match by external_id
    const { data: matchRow, error: findError } = await supabase
      .from('matches')
      .select('id')
      .eq('external_id', externalId)
      .single()

    if (findError || !matchRow) {
      console.warn(`[Relay] Match ${externalId} not in DB yet — Score Agent will catch it`)
      return
    }

    const matchDbId = matchRow.id

    // 2. Upsert sets and games FIRST — so the DB is fully consistent before
    //    we touch the matches row.  The client watches the matches table; by
    //    writing matches LAST we guarantee fetchAll always sees a complete snapshot.
    for (const set of data.sets ?? []) {
      // Skip null sets on finished/ended/bye matches
      if ((data.status === 'finished' || data.status === 'ended' || data.status === 'bye') && !set.set_score) continue

      const isCurrentSet =
        set.set_score === null &&
        set.set_number === Math.max(...(data.sets ?? []).map((s) => s.set_number))

      const { pair1_games, pair2_games } = computePairGames(set)

      const { data: setRow, error: setError } = await supabase
        .from('sets')
        .upsert(
          {
            match_id: matchDbId,
            set_number: set.set_number,
            set_score: normalizeSetScoreFromLive(set.set_score),
            pair1_games,
            pair2_games,
            is_current: isCurrentSet,
            score_source: 'live',  // ← NEW: tag source
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'match_id, set_number' }
        )
        .select('id')
        .single()

      if (setError || !setRow) continue

      for (const game of set.games ?? []) {
        const isCurrentGame =
          isCurrentSet &&
          game.game_number === Math.max(...(set.games ?? []).map((g) => g.game_number))

        // Guard: on finish/ended, don't overwrite with fewer points
        let pointsToWrite = game.points ?? []
        const isFinishing = data.status === 'finished' || data.status === 'ended'
        if (isFinishing) {
          const { data: existing } = await supabase.from('games')
            .select('points')
            .eq('set_id', setRow.id)
            .eq('game_number', game.game_number)
            .maybeSingle()
          const existingPoints = (existing?.points ?? [])
          if (existingPoints.length > pointsToWrite.length) {
            pointsToWrite = existingPoints
          }
        }

        await supabase
          .from('games')
          .upsert(
            {
              set_id: setRow.id,
              match_id: matchDbId,
              game_number: game.game_number,
              game_score: game.game_score,
              points: pointsToWrite,
              is_current: isCurrentGame,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'set_id, game_number' }
          )
      }
    }

    // 3. Update match status, coverage and raw payload LAST — all sets/games
    //    are now fully written so clients that react to this event get a
    //    consistent snapshot in their next fetchAll.
    await supabase
      .from('matches')
      .update({
        status: data.status,
        coverage: data.coverage,
        raw_payload: data,
        updated_at: new Date().toISOString(),
        ...(data.status === 'finished' ? { finished_at: new Date().toISOString() } : {}),
      })
      .eq('id', matchDbId)

    // 4. If match finished or ended — trigger final state fetch
    if (data.status === 'finished' || data.status === 'ended' || data.status === 'bye') {
      console.log(`[Relay] Match ${externalId} ${data.status} — triggering final state fetch`)
      await fetchAndWriteFinalState(externalId, matchDbId)

      // ── Inference fallback ──
      if (data.status === 'finished') {
        await new Promise((resolve) => setTimeout(resolve, 500))
        await tryInferFinalScore(matchDbId)
      }

      // ── Cleanup: clear is_current flags + compute coverage ──
      if (data.status === 'finished') {
        await cleanupMatchFinish(matchDbId)
      }

      // Only unsubscribe on finished/bye — keep listening during ended in case it updates
      if (data.status === 'finished' || data.status === 'bye') unsubscribeChannel(data.channel)
    } else {
      console.log(`[Relay] ✓ Updated match ${externalId} (${data.status}) sets: ${data.sets?.length ?? 0}`)
    }
  } catch (err) {
    console.error(`[Relay] Error handling update for match ${externalId}:`, err)
  }
}

// ── Fetch final authoritative state from REST endpoint ────────
// Called when a match finishes to get the clean final score
// Uses GET /api/matches/{id} which returns correct score format
async function fetchAndWriteFinalState(externalId, matchDbId) {
  const token = process.env.PADELAPI_TOKEN
  if (!token) {
    console.warn('[Relay] No PADELAPI_TOKEN — cannot fetch final state')
    return
  }

  try {
    const res = await fetch(`https://padelapi.org/api/matches/${externalId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      console.warn(`[Relay] Final state fetch returned ${res.status} for match ${externalId}`)
      return
    }

    const match = await res.json()

    // Parse winner: "team_1" → 1, "team_2" → 2
    const winnerPair = match.winner === 'team_1' ? 1 : match.winner === 'team_2' ? 2 : null

    // Parse score array into set scores
    // API format: [{ team_1: "7", team_2: "6(7)" }, { team_1: "6", team_2: "0" }]
    const sets = (match.score ?? []).map((s, idx) => ({
      set_number: idx + 1,
      set_score: normalizeSetScore(s.team_1, s.team_2),
    }))

    // Update match with final authoritative data
    const startedAt = match.started_time
      ? new Date(match.started_time).toISOString()
      : null

    await supabase
      .from('matches')
      .update({
        winner_pair: winnerPair,
        status: 'finished',
        finished_at: new Date().toISOString(),
        duration: match.duration ?? null,
        started_at: startedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', matchDbId)

    // Upsert set scores — use upsert not update so missing sets get created
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
            score_source: 'api',  // ← NEW: authoritative data
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'match_id, set_number' }
        )
    }

    // Delete orphan null sets
    await supabase
      .from('sets')
      .delete()
      .eq('match_id', matchDbId)
      .is('set_score', null)

    console.log(`[Relay] ✓ Final state written for match ${externalId} — winner: pair ${winnerPair}, sets: ${sets.length}`)
  } catch (err) {
    console.error(`[Relay] Error fetching final state for match ${externalId}:`, err)
  }
}

// ── Normalize set score to clean format ───────────────────────
function normalizeSetScore(team1, team2) {
  if (!team1 || !team2) return null
  return `${team1}-${team2}`
}

// ── Normalize live set score (from /live endpoint) ────────────
// "7-66" → "7-6(6)", "67-7" → "6(7)-7", "6-3" → "6-3" (unchanged)
function normalizeSetScoreFromLive(rawScore) {
  if (!rawScore) return null
  const parts = rawScore.split('-')
  if (parts.length !== 2) return rawScore
  const p1str = parts[0]
  const p2str = parts[1]
  if (p2str.includes('(') || p1str.includes('(')) return rawScore
  const p1 = parseInt(p1str)
  // Tiebreak appended to p2: "7-66" → "7-6(6)"
  if (p2str.length >= 2 && p1 <= 7) {
    const realP2 = parseInt(p2str[0])
    const tb = parseInt(p2str.slice(1))
    if (realP2 >= 6 && realP2 <= 7 && !isNaN(tb)) {
      return `${p1}-${realP2}(${tb})`
    }
  }
  // Tiebreak appended to p1: "67-7" → "6(7)-7"
  const p2 = parseInt(p2str)
  if (p1str.length >= 2 && p2 <= 7) {
    const realP1 = parseInt(p1str[0])
    const tb = parseInt(p1str.slice(1))
    if (realP1 >= 6 && realP1 <= 7 && !isNaN(tb)) {
      return `${realP1}(${tb})-${p2}`
    }
  }
  return rawScore
}

// ── Compute pair game counts from a set ───────────────────────
// For a completed set: parse from set_score
// For the current set (set_score null): last game's game_score holds
// the games tally at the start of that game — e.g. "1-2" → pair1=1, pair2=2
function computePairGames(set) {
  if (set.set_score !== null && set.set_score !== undefined) {
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

// ── Subscribe to a Pusher channel ────────────────────────────
function subscribeChannel(channelName, externalId) {
  if (activeChannels.has(channelName)) return

  const pusher = getPusherClient()
  const channel = pusher.subscribe(channelName)

  channel.bind(PUSHER_EVENT, (data) => {
    handleLiveUpdate(data).catch((err) =>
      console.error(`[Relay] Unhandled error on ${channelName}:`, err)
    )
  })

  channel.bind('pusher:subscription_error', (err) => {
    console.error(`[Relay] Subscription error on ${channelName}:`, err)
    activeChannels.delete(channelName)
    channelMatchIds.delete(channelName)
  })

  channel.bind('pusher:subscription_succeeded', () => {
    console.log(`[Relay] ✓ Subscribed to ${channelName} (match ${externalId})`)
  })

  activeChannels.set(channelName, channel)
  channelMatchIds.set(channelName, externalId)
}

// ── Unsubscribe from a Pusher channel ────────────────────────
function unsubscribeChannel(channelName) {
  if (!activeChannels.has(channelName)) return
  const pusher = getPusherClient()
  pusher.unsubscribe(channelName)
  activeChannels.delete(channelName)
  channelMatchIds.delete(channelName)
  console.log(`[Relay] Unsubscribed from ${channelName}`)
}

// ── Re-seed all channels after reconnect ──────────────────────
async function reseedAllChannels() {
  for (const [channelName, externalId] of channelMatchIds.entries()) {
    try {
      const token = process.env.PADELAPI_TOKEN
      if (!token) continue

      const res = await fetch(`https://padelapi.org/api/matches/${externalId}/live`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.ok) {
        const data = await res.json()
        await handleLiveUpdate(data)
        console.log(`[Relay] Re-seeded match ${externalId} after reconnect`)
      }
    } catch (err) {
      console.error(`[Relay] Re-seed failed for match ${externalId}:`, err)
    }
  }
}

// ── Sync channels from DB ─────────────────────────────────────
async function syncChannels() {
  try {
    const { data: liveMatches, error } = await supabase
      .from('matches')
      .select('external_id, pusher_channel')
      .in('status', ['live', 'ended'])
      .not('pusher_channel', 'is', null)

    if (error) {
      console.error('[Relay] Failed to fetch live matches:', error)
      return { added: 0, removed: 0, active: activeChannels.size }
    }

    const liveChannels = new Set((liveMatches ?? []).map((m) => m.pusher_channel))

    let added = 0
    for (const match of liveMatches ?? []) {
      if (!activeChannels.has(match.pusher_channel)) {
        subscribeChannel(match.pusher_channel, match.external_id)
        added++
      }
    }

    let removed = 0
    for (const channelName of activeChannels.keys()) {
      if (!liveChannels.has(channelName)) {
        unsubscribeChannel(channelName)
        removed++
      }
    }

    console.log(`[Relay] Sync: +${added} -${removed} active=${activeChannels.size}`)
    return { added, removed, active: activeChannels.size }
  } catch (err) {
    console.error('[Relay] Sync error:', err)
    return { added: 0, removed: 0, active: activeChannels.size, error: String(err) }
  }
}

// ── Express HTTP server ───────────────────────────────────────
const app = express()
app.use(express.json())

function requireSecret(req, res, next) {
  const auth = req.headers['authorization']
  if (RELAY_SECRET && auth !== `Bearer ${RELAY_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    pusherState: pusherClient?.connection?.state ?? 'not_initialized',
    activeChannels: activeChannels.size,
    channels: [...activeChannels.keys()],
    uptime: process.uptime(),
  })
})

app.post('/sync', requireSecret, async (req, res) => {
  const result = await syncChannels()
  res.json({ ok: true, ...result })
})

app.get('/sync', requireSecret, async (req, res) => {
  const result = await syncChannels()
  res.json({ ok: true, ...result })
})

app.post('/subscribe', requireSecret, (req, res) => {
  const { channel, externalId } = req.body
  if (!channel) return res.status(400).json({ error: 'channel required' })
  subscribeChannel(channel, externalId ?? channel.replace('matches.', ''))
  res.json({ ok: true, subscribed: channel })
})

// ── Simulate referee scoring events (ops dashboard) ───────────
app.post('/simulate', requireSecret, async (req, res) => {
  const { action, matchId, externalId, data } = req.body

  if (!action || !matchId) {
    return res.status(400).json({ error: 'action and matchId are required' })
  }

  const now = new Date().toISOString()

  try {
    if (action === 'start_match') {
      // 1. Upsert initial set
      const { data: setRow, error: setError } = await supabase
        .from('sets')
        .upsert(
          {
            match_id: matchId,
            set_number: 1,
            set_score: null,
            pair1_games: 0,
            pair2_games: 0,
            is_current: true,
            score_source: 'live',
            updated_at: now,
          },
          { onConflict: 'match_id, set_number' }
        )
        .select('id')
        .single()

      if (setError || !setRow) {
        console.error('[Simulate] Failed to upsert initial set:', setError)
        return res.status(500).json({ error: 'Failed to upsert initial set', detail: setError?.message })
      }

      // 2. Upsert initial game
      const { error: gameError } = await supabase
        .from('games')
        .upsert(
          {
            set_id: setRow.id,
            match_id: matchId,
            game_number: 1,
            game_score: '0-0',
            points: ['0:0'],
            is_current: true,
            updated_at: now,
          },
          { onConflict: 'set_id, game_number' }
        )

      if (gameError) {
        console.error('[Simulate] Failed to upsert initial game:', gameError)
        return res.status(500).json({ error: 'Failed to upsert initial game', detail: gameError.message })
      }

      // 3. Update match status LAST
      const { error: matchError } = await supabase
        .from('matches')
        .update({ status: 'live', started_at: now, updated_at: now })
        .eq('id', matchId)

      if (matchError) {
        console.error('[Simulate] Failed to update match status:', matchError)
        return res.status(500).json({ error: 'Failed to update match', detail: matchError.message })
      }

      console.log(`[Simulate] start_match: match ${matchId} (${externalId ?? 'no externalId'})`)
      return res.json({ ok: true, action })
    }

    if (action === 'point' || action === 'undo_point') {
      if (!data?.sets) {
        return res.status(400).json({ error: 'data.sets required for point/undo_point' })
      }

      // Write all sets and games first
      for (const set of data.sets) {
        const { data: setRow, error: setError } = await supabase
          .from('sets')
          .upsert(
            {
              match_id: matchId,
              set_number: set.set_number,
              set_score: set.set_score ?? null,
              pair1_games: set.pair1_games ?? 0,
              pair2_games: set.pair2_games ?? 0,
              is_current: set.is_current ?? false,
              score_source: 'live',
              updated_at: now,
            },
            { onConflict: 'match_id, set_number' }
          )
          .select('id')
          .single()

        if (setError || !setRow) {
          console.error('[Simulate] Failed to upsert set:', setError)
          return res.status(500).json({ error: 'Failed to upsert set', detail: setError?.message })
        }

        for (const game of set.games ?? []) {
          const { error: gameError } = await supabase
            .from('games')
            .upsert(
              {
                set_id: setRow.id,
                match_id: matchId,
                game_number: game.game_number,
                game_score: game.game_score ?? '0-0',
                points: game.points ?? ['0:0'],
                is_current: game.is_current ?? false,
                updated_at: now,
              },
              { onConflict: 'set_id, game_number' }
            )

          if (gameError) {
            console.error('[Simulate] Failed to upsert game:', gameError)
            return res.status(500).json({ error: 'Failed to upsert game', detail: gameError.message })
          }
        }
      }

      // Update match status LAST
      const { error: matchError } = await supabase
        .from('matches')
        .update({ status: data.status ?? 'live', updated_at: now })
        .eq('id', matchId)

      if (matchError) {
        console.error('[Simulate] Failed to update match status:', matchError)
        return res.status(500).json({ error: 'Failed to update match', detail: matchError.message })
      }

      console.log(`[Simulate] ${action}: match ${matchId}`)
      return res.json({ ok: true, action })
    }

    if (action === 'finish_match') {
      if (!data?.sets) {
        return res.status(400).json({ error: 'data.sets required for finish_match' })
      }

      // Write all sets and games first (same as point)
      for (const set of data.sets) {
        const { data: setRow, error: setError } = await supabase
          .from('sets')
          .upsert(
            {
              match_id: matchId,
              set_number: set.set_number,
              set_score: set.set_score ?? null,
              pair1_games: set.pair1_games ?? 0,
              pair2_games: set.pair2_games ?? 0,
              is_current: set.is_current ?? false,
              score_source: 'live',
              updated_at: now,
            },
            { onConflict: 'match_id, set_number' }
          )
          .select('id')
          .single()

        if (setError || !setRow) {
          console.error('[Simulate] Failed to upsert set:', setError)
          return res.status(500).json({ error: 'Failed to upsert set', detail: setError?.message })
        }

        for (const game of set.games ?? []) {
          const { error: gameError } = await supabase
            .from('games')
            .upsert(
              {
                set_id: setRow.id,
                match_id: matchId,
                game_number: game.game_number,
                game_score: game.game_score ?? '0-0',
                points: game.points ?? [],
                is_current: false,
                updated_at: now,
              },
              { onConflict: 'set_id, game_number' }
            )

          if (gameError) {
            console.error('[Simulate] Failed to upsert game:', gameError)
            return res.status(500).json({ error: 'Failed to upsert game', detail: gameError.message })
          }
        }
      }

      // Infer winner from set scores
      let winner_pair = null
      let p1Sets = 0, p2Sets = 0
      for (const set of data.sets) {
        if (set.set_score) {
          const parts = set.set_score.split('-')
          const p1 = parseInt(parts[0]) || 0
          const p2 = parseInt(parts[1]) || 0
          if (p1 > p2) p1Sets++
          else if (p2 > p1) p2Sets++
        }
      }
      if (p1Sets >= 2) winner_pair = 1
      else if (p2Sets >= 2) winner_pair = 2

      // Update match LAST
      const { error: matchError } = await supabase
        .from('matches')
        .update({
          status: 'finished',
          finished_at: now,
          updated_at: now,
          winner_pair,
        })
        .eq('id', matchId)

      if (matchError) {
        console.error('[Simulate] Failed to update match to finished:', matchError)
        return res.status(500).json({ error: 'Failed to finish match', detail: matchError.message })
      }

      // Cleanup: clear is_current + compute coverage
      await cleanupMatchFinish(matchId)

      console.log(`[Simulate] finish_match: match ${matchId} — winner: pair ${winner_pair} (${p1Sets}-${p2Sets} sets)`)
      return res.json({ ok: true, action, winner_pair })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err) {
    console.error(`[Simulate] Unhandled error for action ${action}, match ${matchId}:`, err)
    return res.status(500).json({ error: 'Internal server error', detail: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`[Relay] 🚀 PadelNacho Pusher Relay started on port ${PORT}`)
  console.log(`[Relay] Pusher: ${PUSHER_APP_KEY} (${PUSHER_CLUSTER})`)

  getPusherClient()

  setTimeout(() => {
    console.log('[Relay] Running initial channel sync...')
    syncChannels().catch(console.error)
  }, 3000)
})

process.on('SIGTERM', () => {
  console.log('[Relay] SIGTERM received — shutting down gracefully')
  if (pusherClient) pusherClient.disconnect()
  process.exit(0)
})
