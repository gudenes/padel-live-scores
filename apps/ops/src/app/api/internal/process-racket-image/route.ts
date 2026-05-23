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
    const { width, height } = info

    // Edge-flood-fill: only remove near-white pixels REACHABLE from an image edge
    // via a chain of other near-white pixels. Interior near-white pixels (e.g. a
    // white racket frame surrounded by colored pixels) are preserved.
    //
    // Uses an iterative DFS with a stack to avoid recursion + minimize
    // allocations. Memory: visited bitmap = width*height bytes (~640KB for 800x800).
    const visited = new Uint8Array(width * height)
    const stack: number[] = []

    // Helper: is this pixel near-white enough to be a candidate for transparency?
    const isNearWhite = (pixelIdx: number): boolean => {
      const r = data[pixelIdx]
      const g = data[pixelIdx + 1]
      const b = data[pixelIdx + 2]
      return Math.min(r, g, b) >= WHITE_THRESHOLD - EDGE_FEATHER
    }

    // Seed: every pixel on the four edges
    for (let x = 0; x < width; x++) {
      stack.push(x) // top row
      stack.push((height - 1) * width + x) // bottom row
    }
    for (let y = 1; y < height - 1; y++) {
      stack.push(y * width) // left column
      stack.push(y * width + (width - 1)) // right column
    }

    // Iterative flood-fill
    while (stack.length > 0) {
      const idx = stack.pop()!
      if (visited[idx]) continue
      visited[idx] = 1

      const pixelIdx = idx * 4
      if (!isNearWhite(pixelIdx)) continue // wall — flood stops here

      // Apply transparency (with feathering)
      const r = data[pixelIdx]
      const g = data[pixelIdx + 1]
      const b = data[pixelIdx + 2]
      const minRGB = Math.min(r, g, b)
      if (minRGB >= WHITE_THRESHOLD) {
        data[pixelIdx + 3] = 0
      } else {
        // partial alpha for soft edges in the feather zone
        const t = (minRGB - (WHITE_THRESHOLD - EDGE_FEATHER)) / EDGE_FEATHER
        data[pixelIdx + 3] = Math.round(data[pixelIdx + 3] * (1 - t))
      }

      // Push 4 neighbors
      const x = idx % width
      const y = (idx - x) / width
      if (x > 0) stack.push(idx - 1)
      if (x < width - 1) stack.push(idx + 1)
      if (y > 0) stack.push(idx - width)
      if (y < height - 1) stack.push(idx + width)
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
