// src/app/api/ops/parse-draw/route.ts
// Accepts draw PDF (multipart/form-data) and returns parsed bracket data.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { cookies } from 'next/headers'
import { parseDrawText } from '@/lib/draw-parser'

export async function POST(request: Request) {
  // Auth check
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  if (!process.env.CRON_SECRET) {
    console.error('[Ops Auth] CRON_SECRET env var is not set')
    return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  }
  if (token !== process.env.CRON_SECRET) {
    console.error('[Ops Auth] Token mismatch', { hasToken: !!token, tokenLength: token?.length })
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
    // Polyfill DOMMatrix for serverless environments (Vercel)
    if (typeof globalThis.DOMMatrix === 'undefined') {
      (globalThis as any).DOMMatrix = class DOMMatrix {
        constructor() { return Object.create(DOMMatrix.prototype) }
        static fromMatrix() { return new DOMMatrix() }
      }
    }

    const { PDFParse } = await import('pdf-parse')
    const buffer = await file.arrayBuffer()
    const uint8 = new Uint8Array(buffer)
    const doc = new PDFParse({ data: uint8 })

    const result = await doc.getText()
    const text = result?.text ?? ''

    if (!text.trim()) {
      return Response.json({
        error: 'No text extracted from PDF.',
      }, { status: 422 })
    }

    const parseResult = parseDrawText(text)

    return Response.json({
      ...parseResult,
      filename: file.name,
    })
  } catch (e) {
    return Response.json({
      error: `PDF parsing failed: ${e instanceof Error ? e.message : String(e)}`,
    }, { status: 422 })
  }
}
