// relay/index.js
// PadelNacho — Persistent Pusher Relay
// Always-on Node.js service deployed on Railway
// Holds open WebSocket connections to padelapi.org Pusher channels
// and writes every point update directly to Supabase

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

    // 2. Update match status, coverage and raw payload
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

    // 3. Upsert sets and games
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

        await supabase
          .from('games')
          .upsert(
            {
              set_id: setRow.id,
              match_id: matchDbId,
              game_number: game.game_number,
              game_score: game.game_score,
              points: game.points,
              is_current: isCurrentGame,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'set_id, game_number' }
          )
      }
    }

    // 4. If match finished or ended — trigger final state fetch
    // 'ended' = match over, score being confirmed (transitions to 'finished' within minutes)
    // 'bye' = no match played
    if (data.status === 'finished' || data.status === 'ended' || data.status === 'bye') {
      console.log(`[Relay] Match ${externalId} ${data.status} — triggering final state fetch`)
      await fetchAndWriteFinalState(externalId, matchDbId)
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
    // started_time fills the gap when match was never tracked as live
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
// Input: team_1 = "7", team_2 = "6(7)"
// Output: "7-6(7)"
// Input: team_1 = "6", team_2 = "0"
// Output: "6-0"
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
// Re-fetches the live state for all active matches to fill any gaps
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
// Called by the Vercel cron every 2 minutes
async function syncChannels() {
  try {
    // Get all currently live matches from DB
    const { data: liveMatches, error } = await supabase
      .from('matches')
      .select('external_id, pusher_channel')
      .in('status', ['live', 'ended'])  // ended = still receiving updates
      .not('pusher_channel', 'is', null)

    if (error) {
      console.error('[Relay] Failed to fetch live matches:', error)
      return { added: 0, removed: 0, active: activeChannels.size }
    }

    const liveChannels = new Set((liveMatches ?? []).map((m) => m.pusher_channel))

    // Subscribe to new channels
    let added = 0
    for (const match of liveMatches ?? []) {
      if (!activeChannels.has(match.pusher_channel)) {
        subscribeChannel(match.pusher_channel, match.external_id)
        added++
      }
    }

    // Unsubscribe from channels no longer live
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

// Auth middleware
function requireSecret(req, res, next) {
  const auth = req.headers['authorization']
  if (RELAY_SECRET && auth !== `Bearer ${RELAY_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// GET /health — health check (no auth required)
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    pusherState: pusherClient?.connection?.state ?? 'not_initialized',
    activeChannels: activeChannels.size,
    channels: [...activeChannels.keys()],
    uptime: process.uptime(),
  })
})

// POST /sync — called by Vercel cron to sync channel subscriptions
app.post('/sync', requireSecret, async (req, res) => {
  const result = await syncChannels()
  res.json({ ok: true, ...result })
})

// GET /sync — also accept GET for easier manual testing
app.get('/sync', requireSecret, async (req, res) => {
  const result = await syncChannels()
  res.json({ ok: true, ...result })
})

// POST /subscribe — manually subscribe to a specific channel
app.post('/subscribe', requireSecret, (req, res) => {
  const { channel, externalId } = req.body
  if (!channel) return res.status(400).json({ error: 'channel required' })
  subscribeChannel(channel, externalId ?? channel.replace('matches.', ''))
  res.json({ ok: true, subscribed: channel })
})

// Start server
app.listen(PORT, () => {
  console.log(`[Relay] 🚀 PadelNacho Pusher Relay started on port ${PORT}`)
  console.log(`[Relay] Pusher: ${PUSHER_APP_KEY} (${PUSHER_CLUSTER})`)

  // Initialize Pusher connection immediately
  getPusherClient()

  // Initial sync on startup
  setTimeout(() => {
    console.log('[Relay] Running initial channel sync...')
    syncChannels().catch(console.error)
  }, 3000)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Relay] SIGTERM received — shutting down gracefully')
  if (pusherClient) pusherClient.disconnect()
  process.exit(0)
})
