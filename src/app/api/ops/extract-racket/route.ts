// src/app/api/ops/extract-racket/route.ts
// Extract racket specs from a product URL using Claude AI.
// Auth: reads ops_token cookie.

import { cookies } from 'next/headers'
import Anthropic from '@anthropic-ai/sdk'

// ── Auth ────────────────────────────────────────────────────────
async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  }
  if (token !== cronSecret) {
    return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  }
  return null
}

// ── Fetch page text ─────────────────────────────────────────────
async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`)
  const html = await res.text()
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000)
}

// ── POST: Extract racket specs from URL ─────────────────────────
export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json() as { url?: string }
  const { url } = body

  if (!url || !url.startsWith('http')) {
    return Response.json({ error: 'Missing or invalid URL' }, { status: 400 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  try {
    // Fetch the page
    const pageText = await fetchPageText(url)
    if (pageText.length < 50) {
      return Response.json({ error: 'Could not extract meaningful content from URL' }, { status: 422 })
    }

    // Ask Claude to extract specs
    const anthropic = new Anthropic()
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `Extract padel racket specifications from this product page content.

Return a JSON object with these fields:
- "brand": brand name (e.g. "Bullpadel", "HEAD", "Nox")
- "model": racket model name without brand (e.g. "Hack 04", "Extreme Motion")
- "year": numeric year (e.g. 2026) or null
- "shape": one of "diamond", "round", "teardrop", "hybrid" or null
- "weight_grams": numeric weight in grams (e.g. 365) or null
- "balance": one of "head-heavy", "balanced", "head-light" or null
- "image_url": direct URL to the best product image (jpg/png/webp) or null
- "product_url": the canonical product page URL or null

Respond ONLY with a JSON object. Use null for fields you can't determine.

Page content:
${pageText}`,
        },
      ],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return Response.json({ error: 'Could not parse AI response', raw: text.slice(0, 200) }, { status: 422 })
    }

    const parsed = JSON.parse(jsonMatch[0])

    // Validate and sanitize
    const result = {
      brand: typeof parsed.brand === 'string' ? parsed.brand.trim() : null,
      model: typeof parsed.model === 'string' ? parsed.model.trim() : null,
      year: typeof parsed.year === 'number' && parsed.year > 2000 && parsed.year < 2100 ? parsed.year : null,
      shape: ['diamond', 'round', 'teardrop', 'hybrid'].includes(parsed.shape) ? parsed.shape : null,
      weight_grams: typeof parsed.weight_grams === 'number' && parsed.weight_grams > 200 && parsed.weight_grams < 500 ? parsed.weight_grams : null,
      balance: ['head-heavy', 'balanced', 'head-light'].includes(parsed.balance) ? parsed.balance : null,
      image_url: typeof parsed.image_url === 'string' && parsed.image_url.startsWith('http') ? parsed.image_url : null,
      product_url: url, // Always use the input URL as product_url
    }

    return Response.json({ specs: result })
  } catch (e) {
    console.error('[Extract Racket] Error:', e)
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
