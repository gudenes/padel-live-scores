// supabase/functions/pusher-relay/index.ts
// Pusher Relay Agent
// Holds open WebSocket connections to padelapi.org Pusher channels
// and writes every point update directly to Supabase

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import PusherClient from 'https://esm.sh/pusher-js@8.4.0-rc2'

const PUSHER_APP_KEY = '0ffbefeb945e4e466065'
const PUSHER_CLUSTER = 'eu'
const PUSHER_EVENT = 'App\\PadelApi\\Events\\MatchLiveUpdated'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// ── Types ─────────────────────────────────────────────────────
interface LiveState {
  id: number
  status: string
  coverage: string | null
  channel: string
  sets: Array<{
    set_number: number
    set_score: string | null
    games: Array<{
      game_number: number
      game_score: string
      points: string[]
    }>
  }>
}

// ── Active subscriptions registry ────────────────────────────
const activeChannels = new Map<string, ReturnType<PusherClient['subscribe']>>()
let pusherClient: PusherClient | null = null

// ── Get or create Pusher client ───────────────────────────────
function getPusherClient(): PusherClient {
  if (pusherClient) return pusherClient

  pusherClient = new PusherClient(PUSHER_APP_KEY, {
    cluster: PUSHER_CLUSTER,
  })

  pusherClient.connection.bind('connected', () => {
    console.log('[Relay] Pusher connected')
  })

  pusherClient.connection.bind('disconnected', () => {
    console.warn('[Relay] Pusher disconnected — will reconnect automatically')
  })

  pusherClient.connection.bind('error', (err: unknown) => {
    console.error('[Relay] Pusher connection error:', err)
  })

  return pusherClient
}

// ── Write live state update to Supabase ───────────────────────
async function handleLiveUpdate(data: LiveState): Promise<void> {
  const externalId = String(data.id)

  // 1. Find the match in DB by external_id
  const { data: matchRow, error: matchFindError } = await supabase
    .from('matches')
    .select('id')
    .eq('external_id', externalId)
    .single()

  if (matchFindError || !matchRow) {
    console.warn(`[Relay] Match ${externalId} not found in DB — Score Agent may not have synced it yet`)
    return
  }

  const matchDbId = matchRow.id

  // 2. Update match status and coverage
  const { error: matchUpdateError } = await supabase
    .from('matches')
    .update({
      status: data.status,
      coverage: data.coverage,
      raw_payload: data,
      updated_at: new Date().toISOString(),
      ...(data.status === 'finished' ? { finished_at: new Date().toISOString() } : {}),
    })
    .eq('id', matchDbId)

  if (matchUpdateError) {
    console.error(`[Relay] Failed to update match ${externalId}:`, matchUpdateError)
    return
  }

  // 3. Upsert sets and games
  for (const set of data.sets) {
    const isCurrentSet =
      set.set_score === null &&
      set.set_number === Math.max(...data.sets.map((s) => s.set_number))

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
      console.error(`[Relay] Failed to upsert set ${set.set_number}:`, setError)
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
        console.error(`[Relay] Failed to upsert game ${game.game_number}:`, gameError)
      }
    }
  }

  console.log(`[Relay] ✓ Updated match ${externalId} (${data.status}) — ${data.sets.length} sets`)

  // 4. If match finished, unsubscribe from channel
  if (data.status === 'finished') {
    unsubscribeFromMatch(data.channel)
    console.log(`[Relay] Match ${externalId} finished — unsubscribed from ${data.channel}`)
  }
}

// ── Subscribe to a match channel ──────────────────────────────
function subscribeToMatch(channelName: string): void {
  if (activeChannels.has(channelName)) {
    console.log(`[Relay] Already subscribed to ${channelName}`)
    return
  }

  const pusher = getPusherClient()
  const channel = pusher.subscribe(channelName)

  channel.bind(PUSHER_EVENT, async (data: LiveState) => {
    console.log(`[Relay] Event received on ${channelName}`)
    await handleLiveUpdate(data)
  })

  channel.bind('pusher:subscription_error', (err: unknown) => {
    console.error(`[Relay] Subscription error on ${channelName}:`, err)
    activeChannels.delete(channelName)
  })

  activeChannels.set(channelName, channel)
  console.log(`[Relay] Subscribed to ${channelName}`)
}

// ── Unsubscribe from a match channel ─────────────────────────
function unsubscribeFromMatch(channelName: string): void {
  const pusher = getPusherClient()
  pusher.unsubscribe(channelName)
  activeChannels.delete(channelName)
}

// ── Fetch live matches and subscribe to any new ones ──────────
async function syncLiveSubscriptions(): Promise<void> {
  // Get all currently live matches from DB
  const { data: liveMatches, error } = await supabase
    .from('matches')
    .select('pusher_channel, external_id')
    .eq('status', 'live')
    .not('pusher_channel', 'is', null)

  if (error) {
    console.error('[Relay] Failed to fetch live matches from DB:', error)
    return
  }

  if (!liveMatches || liveMatches.length === 0) {
    console.log('[Relay] No live matches in DB to subscribe to')
    return
  }

  // Subscribe to any new channels
  for (const match of liveMatches) {
    if (match.pusher_channel && !activeChannels.has(match.pusher_channel)) {
      subscribeToMatch(match.pusher_channel)
    }
  }

  // Unsubscribe from channels that are no longer live
  const liveChannels = new Set(liveMatches.map((m) => m.pusher_channel))
  for (const [channelName] of activeChannels) {
    if (!liveChannels.has(channelName)) {
      console.log(`[Relay] Channel ${channelName} no longer live — unsubscribing`)
      unsubscribeFromMatch(channelName)
    }
  }

  console.log(`[Relay] Active subscriptions: ${activeChannels.size}`)
}

// ── Main handler ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Auth check
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${Deno.env.get('RELAY_SECRET')}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'sync'

  try {
    if (action === 'sync') {
      // Called by cron every 2min to pick up new live matches
      await syncLiveSubscriptions()

      return new Response(
        JSON.stringify({
          ok: true,
          action: 'sync',
          activeSubscriptions: activeChannels.size,
          channels: [...activeChannels.keys()],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'status') {
      // Health check endpoint
      return new Response(
        JSON.stringify({
          ok: true,
          pusherState: pusherClient?.connection.state ?? 'not_initialized',
          activeSubscriptions: activeChannels.size,
          channels: [...activeChannels.keys()],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'subscribe') {
      // Manually subscribe to a specific channel
      const channel = url.searchParams.get('channel')
      if (!channel) {
        return new Response(JSON.stringify({ error: 'channel param required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      subscribeToMatch(channel)
      return new Response(
        JSON.stringify({ ok: true, subscribed: channel }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[Relay] Fatal error:', err)
    return new Response(
      JSON.stringify({ error: 'Relay failed', detail: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
