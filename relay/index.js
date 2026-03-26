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
      // Skip null sets on finished matches
      if (data.status === 'finished' && !set.set_score) continue

      const isCurrentSet =
        set.set_score === null &&
        set.set_number === Math.max(...(data.sets ?? []).map((s) => s.set_number))

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

    // 4. If match finished — trigger final state fetch
    if (data.status === 'finished') {
      console.log(`[Relay] Match ${externalId} finished — triggering final state fetch`)
      await fetchAndWriteFinalState(externalId, matchDbId)
      unsubscribeChannel(data.channel)
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
    await supabase
      .from('matches')
      .update({
        winner_pair: winnerPair,
        status: 'finished',
        finished_at: new Date().toISOString(),
        duration: match.duration ?? null,
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
      .eq('status', 'live')
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
