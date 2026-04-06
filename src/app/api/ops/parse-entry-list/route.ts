// src/app/api/ops/parse-entry-list/route.ts
// Accepts PDF file (multipart/form-data) or JSON text ({ text: string }).
// Returns parsed teams + PDF metadata.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { cookies } from 'next/headers'
import { parseEntryListText, extractVersion } from '@/lib/entry-list-parser'

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
      const { extractPdfText } = await import('@/lib/pdf-extract')
      const buffer = await file.arrayBuffer()
      text = await extractPdfText(new Uint8Array(buffer))

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
  return Response.json({
    teams: parseResult.teams,
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
