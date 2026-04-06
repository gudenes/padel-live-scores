// src/app/api/ops/seed-entry-list/route.ts
// Accepts confirmed player list + tournament info, seeds players via PlayerResolver.
// Also serves tournament list for the dropdown (GET).
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { PlayerResolver } from '@/lib/player-resolver'
import { toIso2 } from '@/lib/fip-scraper'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ── Auth ────────────────────────────────────────────────────────
async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[Ops Auth] CRON_SECRET env var is not set')
    return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  }
  if (token !== cronSecret) {
    console.error('[Ops Auth] Token mismatch', { hasToken: !!token, tokenLength: token?.length })
    return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  }
  return null
}

// ── GET: List FIP tournaments for dropdown ──────────────────────
export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const action = url.searchParams.get('action')

  if (action === 'list-tournaments') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    // Fetch FIP tournaments: starting within next 30 days, or recently active (ended within 30 days)
    const { data: tournaments, error } = await supabase
      .from('tournaments')
      .select('id, name, country, level, starts_at, ends_at, entry_list_status, categories')
      .eq('source', 'fip')
      .gte('starts_at', thirtyDaysAgo)
      .lte('starts_at', in30Days)
      .order('starts_at', { ascending: true })

    if (error) {
      console.error('[Entry List] Failed to fetch tournaments:', error.message)
      return Response.json({ error: error.message, tournaments: [] }, { status: 500 })
    }

    // Check readiness: which tournaments have entry lists and draws uploaded
    const tournamentIds = (tournaments ?? []).map(t => t.id)

    // Entry list seeds from ops_events (filter in JS — JSONB .in() is unreliable across PostgREST versions)
    const { data: entryListEvents } = await supabase
      .from('ops_events')
      .select('meta')
      .eq('source', 'entry-list-seed')

    const tournamentIdSet = new Set(tournamentIds)
    const entryListTournamentIds = new Set(
      (entryListEvents ?? [])
        .map(e => (e.meta as any)?.tournament_id)
        .filter((id: string) => id && tournamentIdSet.has(id))
    )

    // Draw seeds from tournament_draws
    const { data: drawRows } = await supabase
      .from('tournament_draws')
      .select('tournament_id')
      .in('tournament_id', tournamentIds)

    const drawTournamentIds = new Set(
      (drawRows ?? []).map(r => r.tournament_id)
    )

    const enriched = (tournaments ?? []).map(t => ({
      ...t,
      hasEntryList: entryListTournamentIds.has(t.id),
      hasDraw: drawTournamentIds.has(t.id),
    }))

    return Response.json({ tournaments: enriched })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

// ── PATCH: Update tournament settings (categories, etc.) ────────
export async function PATCH(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json()
  const { tournamentId, categories } = body

  if (!tournamentId) {
    return Response.json({ error: 'Missing tournamentId' }, { status: 400 })
  }

  const updates: Record<string, any> = {}
  if (categories && ['both', 'men_only', 'women_only'].includes(categories)) {
    updates.categories = categories
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('tournaments')
    .update(updates)
    .eq('id', tournamentId)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Recompute entry_list_status based on new categories setting
  const { data: seedEvents } = await supabase
    .from('ops_events')
    .select('meta')
    .eq('source', 'entry-list-seed')
    .eq('status', 'ok')

  const seededCategories = new Set(
    (seedEvents ?? [])
      .filter((e: any) => (e.meta as any)?.tournament_id === tournamentId)
      .map((e: any) => (e.meta as any)?.category)
      .filter(Boolean)
  )

  const requiredCount = updates.categories === 'both' ? 2 : 1
  const newStatus = seededCategories.size >= requiredCount ? 'ready'
    : seededCategories.size >= 1 ? 'partial'
    : 'pending'

  await supabase
    .from('tournaments')
    .update({ entry_list_status: newStatus })
    .eq('id', tournamentId)

  return Response.json({ ok: true, categories: updates.categories, entryListStatus: newStatus })
}

// ── POST: Seed players from entry list ──────────────────────────

interface SeedPlayer {
  name: string
  country: string      // 3-letter code from PDF
  ranking?: number     // FIP ranking from entry list
  points?: number      // FIP points from entry list
  action: 'link' | 'create'
  playerId?: string    // For 'link' action — existing DB player ID
}

interface SeedRequest {
  tournamentId: string
  category: 'men' | 'women'
  drawType?: 'main' | 'qualifying'
  players: SeedPlayer[]
  metadata?: {
    filename?: string
    version?: number | null
    lastModified?: string | null
  }
}

export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body: SeedRequest = await request.json()

  if (!body.tournamentId || !body.category || !body.players?.length) {
    return Response.json({ error: 'Missing required fields: tournamentId, category, players' }, { status: 400 })
  }

  // Verify tournament exists
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name')
    .eq('id', body.tournamentId)
    .single()

  if (!tournament) {
    return Response.json({ error: 'Tournament not found' }, { status: 404 })
  }

  const resolver = new PlayerResolver(supabase)
  await resolver.load()

  let linked = 0
  let created = 0
  const errors: string[] = []
  const newPlayers: { name: string; ranking?: number; country: string }[] = []
  const top100Errors: { name: string; ranking: number; country: string }[] = []

  // Resolve each player and track their resolved IDs (in input order)
  const resolvedIds: (string | null)[] = []

  for (const player of body.players) {
    try {
      if (player.action === 'link' && player.playerId) {
        linked++
        resolvedIds.push(player.playerId)
      } else {
        const iso2 = toIso2(player.country)
        const result = await resolver.resolve({
          name: player.name,
          country: iso2,
          category: body.category,
          ranking: player.ranking || null, // 0 means unranked → treat as null
          points: player.points || null, // 0 means no points → treat as null
        })

        resolvedIds.push(result.playerId ?? null)

        if (result.action === 'created') {
          created++
          newPlayers.push({ name: player.name, ranking: player.ranking, country: player.country })
          // Top-100 rule: ranked players in top 100 MUST already exist in DB
          if (player.ranking != null && player.ranking <= 100) {
            top100Errors.push({ name: player.name, ranking: player.ranking, country: player.country })
          }
        } else {
          linked++
        }
      }
    } catch (e) {
      errors.push(`${player.name}: ${e instanceof Error ? e.message : String(e)}`)
      resolvedIds.push(null)
    }
  }

  // Write pairs to tournament_draws so the entry list shows on the tournament page.
  // Players come in order: indices 0+1 = team 1, 2+3 = team 2, etc.
  // The actual bracket draw (uploaded later) will overwrite these with proper positions.
  for (let i = 0; i < body.players.length; i += 2) {
    const p1 = body.players[i]
    const p2 = body.players[i + 1]
    if (!p1) continue
    const drawPosition = i / 2 + 1

    const { error: upsertError } = await supabase
      .from('tournament_draws')
      .upsert({
        tournament_id: body.tournamentId,
        category: body.category,
        draw_position: drawPosition,
        seed: null,
        marker: null,
        player1_name: p1.name,
        player1_country: toIso2(p1.country),
        player1_id: resolvedIds[i],
        player2_name: p2?.name ?? '',
        player2_country: p2 ? toIso2(p2.country) : null,
        player2_id: p2 ? (resolvedIds[i + 1] ?? null) : null,
        team_points: null,
        round: null,
      }, { onConflict: 'tournament_id,category,draw_position' })

    if (upsertError) {
      console.error(`[seed-entry-list] Upsert failed for position ${drawPosition}:`, upsertError)
      errors.push(`Position ${drawPosition} upsert: ${upsertError.message}`)
    }
  }

  // Log to ops_events for audit trail
  await supabase.from('ops_events').insert({
    source: 'entry-list-seed',
    status: errors.length > 0 ? 'partial' : 'ok',
    started_at: new Date().toISOString(),
    duration_ms: 0,
    meta: {
      tournament_id: body.tournamentId,
      tournament_name: tournament.name,
      category: body.category,
      draw_type: body.drawType ?? 'main',
      filename: body.metadata?.filename ?? null,
      version: body.metadata?.version ?? null,
      last_modified: body.metadata?.lastModified ?? null,
      players_total: body.players.length,
      players_linked: linked,
      players_created: created,
      errors: errors.length,
      new_players: newPlayers.length,
      top100_errors: top100Errors.length,
    },
    error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
  })

  // ── Auto-update entry_list_status ──────────────────────────────
  // Recompute from all entry-list-seed events for this tournament
  // Respects tournament.categories: men_only/women_only tournaments are 'ready' with just one category
  const { data: seedEvents } = await supabase
    .from('ops_events')
    .select('meta')
    .eq('source', 'entry-list-seed')
    .eq('status', 'ok')

  const seededCategories = new Set(
    (seedEvents ?? [])
      .filter((e: any) => (e.meta as any)?.tournament_id === body.tournamentId)
      .map((e: any) => (e.meta as any)?.category)
      .filter(Boolean)
  )

  // Check tournament categories setting
  const { data: tournamentInfo } = await supabase
    .from('tournaments')
    .select('categories')
    .eq('id', body.tournamentId)
    .single()

  const tournamentCategories = tournamentInfo?.categories ?? 'both'
  const requiredCount = tournamentCategories === 'both' ? 2 : 1

  const newStatus = seededCategories.size >= requiredCount ? 'ready'
    : seededCategories.size >= 1 ? 'partial'
    : 'pending'

  await supabase
    .from('tournaments')
    .update({ entry_list_status: newStatus })
    .eq('id', body.tournamentId)

  return Response.json({
    linked,
    created,
    total: body.players.length,
    errors,
    newPlayers,
    top100Errors,
    entryListStatus: newStatus,
  })
}
