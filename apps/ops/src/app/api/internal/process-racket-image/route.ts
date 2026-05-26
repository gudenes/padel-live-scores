// apps/ops/src/app/api/internal/process-racket-image/route.ts
// Removes the background from a racket image via remove.bg API.
// Returns the processed PNG as a base64 data URL so the form keeps it in
// memory until save (existing upload flow handles persistence).
// Auth: Auth.js session with isOperator check.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

const REMOVE_BG_ENDPOINT = 'https://api.remove.bg/v1.0/removebg'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.REMOVE_BG_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'REMOVE_BG_API_KEY not configured' }, { status: 500 })
  }

  const contentType = request.headers.get('content-type') ?? ''

  try {
    // Build the multipart/form-data body for remove.bg.
    // remove.bg accepts EITHER image_file (binary) OR image_url (string).
    const removeBgForm = new FormData()
    removeBgForm.append('size', 'auto')
    removeBgForm.append('format', 'png')
    removeBgForm.append('type', 'product')

    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { url?: string }
      const url = body.url
      if (!url || !url.startsWith('http')) {
        return Response.json({ error: 'Missing or invalid URL' }, { status: 400 })
      }
      removeBgForm.append('image_url', url)
    } else if (contentType.includes('multipart/form-data')) {
      const inputForm = await request.formData()
      const file = inputForm.get('file') as File | null
      if (!file) {
        return Response.json({ error: 'Missing file in form data' }, { status: 400 })
      }
      // Re-wrap as image_file for remove.bg
      removeBgForm.append('image_file', file, file.name || 'image.png')
    } else {
      return Response.json({ error: 'Unsupported content type' }, { status: 415 })
    }

    const res = await fetch(REMOVE_BG_ENDPOINT, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: removeBgForm,
    })

    if (!res.ok) {
      // remove.bg returns JSON errors with this shape: { errors: [{ title, code }] }
      const errBody = await res.text()
      let errorMessage = `remove.bg returned ${res.status}`
      try {
        const parsed = JSON.parse(errBody) as { errors?: Array<{ title?: string; code?: string }> }
        const first = parsed.errors?.[0]
        if (first?.title) errorMessage = `remove.bg: ${first.title}${first.code ? ` (${first.code})` : ''}`
      } catch {
        // Not JSON — use the raw text if it's short
        if (errBody.length < 200) errorMessage = `remove.bg: ${errBody}`
      }
      console.error('[Process Racket Image] remove.bg error:', res.status, errBody.slice(0, 500))
      return Response.json({ error: errorMessage }, { status: res.status === 402 ? 402 : 422 })
    }

    const creditsCharged = res.headers.get('X-Credits-Charged') ?? '?'
    console.log('[Process Racket Image] Credits charged:', creditsCharged)

    const pngBuffer = Buffer.from(await res.arrayBuffer())
    const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`
    return Response.json({ dataUrl })
  } catch (err) {
    console.error('[Process Racket Image] Error:', err)
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
