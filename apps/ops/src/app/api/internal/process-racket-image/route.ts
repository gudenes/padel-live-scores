// apps/ops/src/app/api/internal/process-racket-image/route.ts
// Removes near-white background from a racket image, returns the processed PNG
// as a base64 data URL. Works on either a remote URL or an uploaded file blob.
// Auth: Auth.js session with isOperator check.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import sharp from 'sharp'

// Tunables for near-white detection
const WHITE_THRESHOLD = 240 // R, G, B all >= this → consider transparent
const EDGE_FEATHER = 5 // Pixels within `WHITE_THRESHOLD - EDGE_FEATHER` get partial alpha

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const contentType = request.headers.get('content-type') ?? ''

  let inputBuffer: Buffer | null = null

  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { url?: string }
      const url = body.url
      if (!url || !url.startsWith('http')) {
        return Response.json({ error: 'Missing or invalid URL' }, { status: 400 })
      }
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) {
        return Response.json(
          { error: `Failed to fetch image (HTTP ${res.status})` },
          { status: 422 },
        )
      }
      inputBuffer = Buffer.from(await res.arrayBuffer())
    } else if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file') as File | null
      if (!file) {
        return Response.json({ error: 'Missing file in form data' }, { status: 400 })
      }
      inputBuffer = Buffer.from(await file.arrayBuffer())
    } else {
      return Response.json({ error: 'Unsupported content type' }, { status: 415 })
    }

    // Sharp pipeline:
    // 1. Ensure RGBA
    // 2. Read raw pixels
    // 3. For each pixel: if R,G,B all >= threshold → alpha = 0; partial feathering between threshold-edge and threshold
    const image = sharp(inputBuffer).ensureAlpha()
    const meta = await image.metadata()
    if (!meta.width || !meta.height) {
      return Response.json({ error: 'Could not read image dimensions' }, { status: 422 })
    }
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const minRGB = Math.min(r, g, b)
      if (minRGB >= WHITE_THRESHOLD) {
        data[i + 3] = 0
      } else if (minRGB >= WHITE_THRESHOLD - EDGE_FEATHER) {
        // linear feather between threshold-edge .. threshold → alpha 255 .. 0
        const t = (minRGB - (WHITE_THRESHOLD - EDGE_FEATHER)) / EDGE_FEATHER
        data[i + 3] = Math.round(data[i + 3] * (1 - t))
      }
    }

    const out = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer()

    const dataUrl = `data:image/png;base64,${out.toString('base64')}`
    return Response.json({ dataUrl })
  } catch (err) {
    console.error('[Process Racket Image] Error:', err)
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
