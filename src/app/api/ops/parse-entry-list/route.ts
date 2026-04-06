// src/app/api/ops/parse-entry-list/route.ts
// Accepts PDF file (multipart/form-data) or JSON text ({ text: string }).
// Returns parsed teams + PDF metadata.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { parseEntryListText, extractVersion, type ParsedEntryPlayer } from '@/lib/entry-list-parser'
import { PlayerResolver } from '@/lib/player-resolver'
import { toIso2 } from '@/lib/fip-scraper'

export async function POST(request: Request) {
  // Auth check
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const contentType = request.headers.get('content-type') ?? ''

  let text: string
  let metadata: {
    filename: string | null
    version: number | null
    lastModified: string | null
    pageCount: number | null
    title: string | null
  } = { filename: null, version: null, lastModified: null, pageCount: null, title: null }

  if (contentType.includes('multipart/form-data')) {
    // PDF upload flow
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return Response.json({ error: 'File must be a PDF' }, { status: 400 })
    }

    metadata.filename = file.name
    metadata.version = extractVersion(file.name)

    try {
      const buffer = await file.arrayBuffer()

      // Disable pdfjs worker before importing pdf-parse to avoid Vercel bundling issue
      // The worker .mjs file isn't included in serverless bundles
      try {
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
        if (pdfjsLib.GlobalWorkerOptions) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = ''
        }
      } catch {
        // pdfjs-dist may not be directly importable — pdf-parse handles it internally
      }

      const { PDFParse } = await import('pdf-parse')
      const uint8 = new Uint8Array(buffer)
      const doc = new PDFParse({ data: uint8 })

      // Extract metadata (best-effort)
      try {
        const info = await doc.getInfo()
        if (info) {
          metadata.title = (info.info?.Title as string | undefined) ?? null
          metadata.pageCount = info.total ?? null
        }
      } catch { /* metadata is optional */ }

      const result = await doc.getText()
      text = result?.text ?? ''

      if (!text.trim()) {
        return Response.json({
          error: 'No text extracted from PDF. Try pasting the text instead.',
          metadata,
        }, { status: 422 })
      }
    } catch (e) {
      return Response.json({
        error: `PDF parsing failed: ${e instanceof Error ? e.message : String(e)}`,
      }, { status: 422 })
    }
  } else {
    // Text paste flow
    const body = await request.json()
    text = body.text ?? ''

    if (!text.trim()) {
      return Response.json({ error: 'No text provided' }, { status: 400 })
    }
  }

  const parseResult = parseEntryListText(text)

  // Merge text-extracted metadata with PDF metadata (PDF metadata takes precedence where both exist)
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
      ...metadata,
      // Use PDF title if available, fall back to text-extracted title
      title: metadata.title ?? textMeta.title,
      // Text-extracted fields not available from PDF metadata
      lastUpdate: textMeta.lastUpdate,
      category: textMeta.category,
    },
    playerCount: parseResult.teams.length * 2,
  })
}
