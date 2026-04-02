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
  if (!cronSecret || token !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
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
      .select('id, name, country, level, starts_at, ends_at')
      .eq('source', 'fip')
      .gte('starts_at', thirtyDaysAgo)
      .lte('starts_at', in30Days)
      .order('starts_at', { ascending: true })

    if (error) {
      console.error('[Entry List] Failed to fetch tournaments:', error.message)
      return Response.json({ error: error.message, tournaments: [] }, { status: 500 })
    }

    return Response.json({ tournaments: tournaments ?? [] })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

// ── POST: Seed players from entry list ──────────────────────────

interface SeedPlayer {
  name: string
  country: string      // 3-letter code from PDF
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

  for (const player of body.players) {
    try {
      if (player.action === 'link' && player.playerId) {
        linked++
      } else {
        const iso2 = toIso2(player.country)
        const result = await resolver.resolve({
          name: player.name,
          country: iso2,
          category: body.category,
        })

        if (result.action === 'created') {
          created++
        } else {
          linked++
        }
      }
    } catch (e) {
      errors.push(`${player.name}: ${e instanceof Error ? e.message : String(e)}`)
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
    },
    error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
  })

  return Response.json({
    linked,
    created,
    total: body.players.length,
    errors,
  })
}
