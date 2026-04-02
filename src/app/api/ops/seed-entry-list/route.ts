// src/app/api/ops/seed-entry-list/route.ts
// Accepts confirmed player list + tournament info, seeds players via PlayerResolver.
// Also serves tournament list for the dropdown (GET).

import { createClient } from '@supabase/supabase-js'
import { PlayerResolver } from '@/lib/player-resolver'
import { toIso2 } from '@/lib/fip-scraper'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// Auth: handled by middleware (ops_token cookie check for /api/ops/* paths).

// ── GET: List FIP tournaments for dropdown ──────────────────────
export async function GET(request: Request) {

  const url = new URL(request.url)
  const action = url.searchParams.get('action')

  if (action === 'list-tournaments') {
    const today = new Date().toISOString().slice(0, 10)
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const { data: tournaments } = await supabase
      .from('tournaments')
      .select('id, name, country, level, starts_at, ends_at')
      .eq('source', 'fip')
      .or(`starts_at.lte.${in30Days},and(starts_at.lte.${today},ends_at.gte.${today})`)
      .order('starts_at', { ascending: true })

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
  players: SeedPlayer[]
  metadata?: {
    filename?: string
    version?: number | null
    lastModified?: string | null
  }
}

export async function POST(request: Request) {
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
