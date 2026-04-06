// src/app/api/ops/parse-entry-list/route.ts
// Accepts JSON text ({ text: string }) — PDF extraction happens client-side.
// Returns parsed teams with player matching info.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { parseEntryListText, type ParsedEntryPlayer } from '@/lib/entry-list-parser'
import { PlayerResolver } from '@/lib/player-resolver'
import { toIso2 } from '@/lib/fip-scraper'

export async function POST(request: Request) {
  // Auth check
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // PDF extraction now happens client-side (browser pdf.js) — API only receives text
  const body = await request.json()
  const text: string = body.text ?? ''

  if (!text.trim()) {
    return Response.json({ error: 'No text provided' }, { status: 400 })
  }

  const parseResult = parseEntryListText(text)

  const textMeta = parseResult.metadata

  // Determine category from query param or PDF metadata
  const url = new URL(request.url)
  const categoryParam = url.searchParams.get('category')
  const category = categoryParam ?? textMeta.category ?? null

  // Normalize category from PDF metadata (e.g. "Hombres's" → "men", "Mujeres" → "women")
  const normalizedCategory = category
    ? (category.toLowerCase().includes('hombre') || category === 'men' ? 'men'
      : category.toLowerCase().includes('mujer') || category === 'women' ? 'women'
      : category)
    : null

  // Enrich players with match data if category is available
  interface EnrichedPlayer extends ParsedEntryPlayer {
    matchStatus: 'exact' | 'fuzzy' | 'new'
    matchedPlayerId: string | null
    matchedPlayerName: string | null
    matchedPlayerRanking: number | null
  }

  interface EnrichedTeam {
    position: number
    teamPoints: number
    drawType: string
    isWildCard: boolean
    player1: EnrichedPlayer
    player2: EnrichedPlayer
  }

  let enrichedTeams: EnrichedTeam[]

  if (normalizedCategory === 'men' || normalizedCategory === 'women') {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    )
    const resolver = new PlayerResolver(supabase)
    await resolver.load()

    const enrichPlayer = async (player: ParsedEntryPlayer): Promise<EnrichedPlayer> => {
      const iso2 = toIso2(player.country)
      const result = await resolver.lookup({
        name: player.name,
        country: iso2,
        category: normalizedCategory,
        ranking: player.ranking ?? null,
        points: player.points ?? null,
      })

      if (result.found) {
        return {
          ...player,
          matchStatus: result.matchType === 'fuzzy' ? 'fuzzy' : 'exact',
          matchedPlayerId: result.playerId ?? null,
          matchedPlayerName: result.playerName ?? null,
          matchedPlayerRanking: null, // ranking from DB not exposed in LookupResult
        }
      }

      return {
        ...player,
        matchStatus: 'new',
        matchedPlayerId: null,
        matchedPlayerName: null,
        matchedPlayerRanking: null,
      }
    }

    enrichedTeams = await Promise.all(
      parseResult.teams.map(async (team) => ({
        ...team,
        player1: await enrichPlayer(team.player1),
        player2: await enrichPlayer(team.player2),
      }))
    )
  } else {
    // No category — return players without match data
    enrichedTeams = parseResult.teams.map((team) => ({
      ...team,
      player1: { ...team.player1, matchStatus: 'new' as const, matchedPlayerId: null, matchedPlayerName: null, matchedPlayerRanking: null },
      player2: { ...team.player2, matchStatus: 'new' as const, matchedPlayerId: null, matchedPlayerName: null, matchedPlayerRanking: null },
    }))
  }

  return Response.json({
    teams: enrichedTeams,
    metadata: {
      title: textMeta.title ?? null,
      lastUpdate: textMeta.lastUpdate ?? null,
      category: textMeta.category ?? null,
    },
    playerCount: parseResult.teams.length * 2,
  })
}
