// src/app/api/ops/parse-entry-list/route.ts
// Parses entry list from PDF (via Sonnet) or pasted text (via text parser).
// Returns teams with player matching info.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { parseEntryListText, type ParsedEntryPlayer } from '@/lib/entry-list-parser'
import { parseEntryListPdfWithSonnet } from '@/lib/pdf-parse-sonnet'
import { PlayerResolver } from '@/lib/player-resolver'
import { toIso2 } from '@/lib/fip-scraper'

// ── Enriched types ──────────────────────────────────────────────
interface EnrichedPlayer {
  name: string
  country: string
  ranking: number | null
  points: number | null
  matchStatus: 'exact' | 'fuzzy' | 'new'
  matchedPlayerId: string | null
  matchedPlayerName: string | null
  matchedPlayerRanking: number | null
}

interface EnrichedTeam {
  position: number
  teamPoints: number | null
  drawType: string
  isWildCard: boolean
  player1: EnrichedPlayer
  player2: EnrichedPlayer
}

export async function POST(request: Request) {
  // Auth check
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const contentType = request.headers.get('content-type') ?? ''
  const url = new URL(request.url)
  const categoryParam = url.searchParams.get('category')

  let rawTeams: Array<{
    position: number
    teamPoints: number | null
    drawType: string
    isWildCard: boolean
    player1: { name: string; country: string; ranking: number | null; points: number | null }
    player2: { name: string; country: string; ranking: number | null; points: number | null }
  }>
  let detectedCategory: string | null = null
  let meta: Record<string, any> = {}

  if (contentType.includes('multipart/form-data')) {
    // ── PDF upload → Sonnet extraction ────────────────────────────
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return Response.json({ error: 'File must be a PDF' }, { status: 400 })
    }

    try {
      const buffer = await file.arrayBuffer()
      const result = await parseEntryListPdfWithSonnet(new Uint8Array(buffer))

      detectedCategory = result.metadata.category
      meta = {
        title: result.metadata.tournamentName,
        lastUpdate: result.metadata.lastUpdate,
        category: result.metadata.category,
        filename: file.name,
      }

      rawTeams = result.teams.map(t => ({
        position: t.position,
        teamPoints: t.teamPoints,
        drawType: t.drawType,
        isWildCard: t.isWildCard,
        player1: {
          name: t.player1.name,
          country: t.player1.country,
          ranking: t.player1.ranking,
          points: t.player1.points,
        },
        player2: {
          name: t.player2.name,
          country: t.player2.country,
          ranking: t.player2.ranking,
          points: t.player2.points,
        },
      }))
    } catch (e) {
      return Response.json({
        error: `PDF parsing failed: ${e instanceof Error ? e.message : String(e)}`,
      }, { status: 422 })
    }
  } else {
    // ── Text paste → text parser ──────────────────────────────────
    const body = await request.json()
    const text: string = body.text ?? ''
    if (!text.trim()) return Response.json({ error: 'No text provided' }, { status: 400 })

    const parseResult = parseEntryListText(text)
    detectedCategory = parseResult.metadata.category
    meta = {
      title: parseResult.metadata.title,
      lastUpdate: parseResult.metadata.lastUpdate,
      category: parseResult.metadata.category,
    }

    rawTeams = parseResult.teams.map(t => ({
      position: t.position,
      teamPoints: t.teamPoints,
      drawType: t.drawType,
      isWildCard: t.isWildCard,
      player1: {
        name: t.player1.name,
        country: t.player1.country,
        ranking: t.player1.ranking || null,
        points: t.player1.points || null,
      },
      player2: {
        name: t.player2.name,
        country: t.player2.country,
        ranking: t.player2.ranking || null,
        points: t.player2.points || null,
      },
    }))
  }

  // ── Determine category ──────────────────────────────────────────
  const category = categoryParam ?? detectedCategory ?? null
  const normalizedCategory = category
    ? (category.toLowerCase().includes('hombre') || category === 'men' ? 'men'
      : category.toLowerCase().includes('mujer') || category === 'women' ? 'women'
      : category)
    : null

  // ── Enrich with player matching ─────────────────────────────────
  let enrichedTeams: EnrichedTeam[]

  if (normalizedCategory === 'men' || normalizedCategory === 'women') {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    )
    const resolver = new PlayerResolver(supabase)
    await resolver.load()

    const enrichPlayer = async (player: { name: string; country: string; ranking: number | null; points: number | null }): Promise<EnrichedPlayer> => {
      const iso2 = toIso2(player.country)
      const result = await resolver.lookup({
        name: player.name,
        country: iso2,
        category: normalizedCategory,
        ranking: player.ranking,
        points: player.points,
      })

      return {
        ...player,
        matchStatus: result.found ? (result.matchType === 'fuzzy' ? 'fuzzy' : 'exact') : 'new',
        matchedPlayerId: result.found ? (result.playerId ?? null) : null,
        matchedPlayerName: result.found ? (result.playerName ?? null) : null,
        matchedPlayerRanking: null,
      }
    }

    enrichedTeams = await Promise.all(
      rawTeams.map(async (team) => ({
        ...team,
        player1: await enrichPlayer(team.player1),
        player2: await enrichPlayer(team.player2),
      }))
    )
  } else {
    enrichedTeams = rawTeams.map((team) => ({
      ...team,
      player1: { ...team.player1, matchStatus: 'new' as const, matchedPlayerId: null, matchedPlayerName: null, matchedPlayerRanking: null },
      player2: { ...team.player2, matchStatus: 'new' as const, matchedPlayerId: null, matchedPlayerName: null, matchedPlayerRanking: null },
    }))
  }

  return Response.json({
    teams: enrichedTeams,
    metadata: meta,
    playerCount: rawTeams.length * 2,
  })
}
