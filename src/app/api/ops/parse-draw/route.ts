// src/app/api/ops/parse-draw/route.ts
// Accepts draw PDF (multipart/form-data) and returns parsed bracket data.
// Uses Claude Sonnet for structured extraction — no text parsing step needed.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { cookies } from 'next/headers'
import { parseDrawPdfWithSonnet } from '@/lib/pdf-parse-sonnet'

export async function POST(request: Request) {
  // Auth check
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  }
  if (token !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  }

  const contentType = request.headers.get('content-type') ?? ''

  if (!contentType.includes('multipart/form-data')) {
    return Response.json({ error: 'Expected multipart/form-data with PDF file' }, { status: 400 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return Response.json({ error: 'No file provided' }, { status: 400 })
  }

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return Response.json({ error: 'File must be a PDF' }, { status: 400 })
  }

  try {
    const buffer = await file.arrayBuffer()
    const uint8 = new Uint8Array(buffer)

    const parseResult = await parseDrawPdfWithSonnet(uint8)

    // Defensive sanitization — Sonnet can emit null or missing player names
    // for "BYE" entries or partial PDFs. Coerce to safe strings so the
    // ops UI never hits null.name when rendering bracket slots.
    const safeString = (s: unknown, fallback: string): string =>
      typeof s === 'string' && s.trim().length > 0 ? s.trim() : fallback
    const safeNullable = (s: unknown): string | null =>
      typeof s === 'string' && s.trim().length > 0 ? s.trim() : null
    const safeInt = (n: unknown): number | null =>
      typeof n === 'number' && Number.isFinite(n) ? n : null

    const skipped: Array<{ drawPosition: number | null; reason: string }> = []
    const sanitizedEntries = (parseResult.entries ?? []).flatMap(e => {
      if (!e || typeof e !== 'object') {
        skipped.push({ drawPosition: null, reason: 'entry is null or not an object' })
        return []
      }
      return [{
        drawPosition: e.drawPosition ?? 0,
        round: safeString(e.round, 'R32'),
        seed: safeInt(e.seed),
        marker: (e.marker === 'Q' || e.marker === 'WC' || e.marker === 'LL') ? e.marker : null,
        player1Name: safeString(e.player1Name, 'BYE'),
        player1Country: safeNullable(e.player1Country),
        player2Name: safeString(e.player2Name, 'BYE'),
        player2Country: safeNullable(e.player2Country),
        teamPoints: safeInt(e.teamPoints),
      }]
    })

    const sanitizedSeeded = (parseResult.seededTeams ?? []).flatMap(s => {
      if (!s || typeof s !== 'object') return []
      return [{
        seed: s.seed ?? 0,
        player1: safeString(s.player1, 'Unknown'),
        player2: safeString(s.player2, 'Unknown'),
        points: safeInt(s.points) ?? 0,
      }]
    })

    if (skipped.length > 0) {
      console.warn('[parse-draw] sanitized invalid entries from Sonnet output:', skipped)
    }

    if (sanitizedEntries.length === 0) {
      return Response.json({
        error: 'PDF parsing returned no valid draw entries. The PDF layout may not be supported.',
      }, { status: 422 })
    }

    return Response.json({
      entries: sanitizedEntries,
      seededTeams: sanitizedSeeded,
      metadata: parseResult.metadata,
      warnings: parseResult.warnings ?? [],
      filename: file.name,
    })
  } catch (e) {
    console.error('[parse-draw] parser threw:', e)
    return Response.json({
      error: `PDF parsing failed: ${e instanceof Error ? e.message : String(e)}`,
    }, { status: 422 })
  }
}
