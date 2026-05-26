// apps/ops/src/app/api/internal/extract-racket/route.ts
// Extract racket specs from a product URL using Claude AI.
// Auth: Auth.js session with isOperator flag.
// Ported from src/app/api/ops/extract-racket/route.ts (Plan 3a hotfix).

import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

// ── Fetch + extract structured data from page ───────────────────
async function fetchPageContent(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`)
  const html = await res.text()

  const parts: string[] = []

  // 1. Extract JSON-LD structured data (product info, specs)
  const jsonLdRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1])
      parts.push(`[JSON-LD]: ${JSON.stringify(data).slice(0, 2000)}`)
    } catch { /* ignore malformed JSON-LD */ }
  }

  // 2. Extract meta tags (og:image, product meta, description)
  const metaRe = /<meta[^>]+(?:property|name)=["']([^"']+)["'][^>]+content=["']([^"']+)["'][^>]*>/gi
  while ((m = metaRe.exec(html)) !== null) {
    const prop = m[1].toLowerCase()
    if (prop.includes('image') || prop.includes('description') || prop.includes('title') || prop.includes('product')) {
      parts.push(`[META ${m[1]}]: ${m[2]}`)
    }
  }

  // 3. Extract image URLs from product context (src attributes with product-like paths)
  const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  const images: string[] = []
  while ((m = imgRe.exec(html)) !== null) {
    const src = m[1]
    if (src.includes('product') || src.includes('racket') || src.includes('pala') || src.includes('cdn/shop')) {
      images.push(src.startsWith('//') ? `https:${src}` : src)
    }
  }
  if (images.length > 0) {
    parts.push(`[PRODUCT IMAGES]: ${[...new Set(images)].slice(0, 5).join(' | ')}`)
  }

  // 4. Strip HTML to plain text
  const plainText = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10000)

  parts.push(`[PAGE TEXT]: ${plainText}`)

  return parts.join('\n\n')
}

// ── POST: Extract racket specs from URL ─────────────────────────
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { url?: string }
  const { url } = body

  if (!url || !url.startsWith('http')) {
    return Response.json({ error: 'Missing or invalid URL' }, { status: 400 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  try {
    // Fetch the page with structured data extraction
    const pageContent = await fetchPageContent(url)
    if (pageContent.length < 50) {
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
          content: `Extract padel racket specifications from this product page. The content below includes structured data (JSON-LD, meta tags, product images) and plain text from the page.

Return a JSON object with these fields:
- "brand": brand name (e.g. "Bullpadel", "HEAD", "Nox", "Tactical")
- "model": racket model name without brand (e.g. "Hack 04", "Extreme Motion")
- "year": numeric year (e.g. 2026) or null
- "shape": one of "diamond", "round", "teardrop", "hybrid" or null. Look for terms like "round shape", "diamond", "teardrop", "drop", "oversize". Also "redonda"=round, "diamante"=diamond, "lágrima"=teardrop.
- "weight_grams": numeric weight in grams (e.g. 365) or null. If a range like "355-365g", use the midpoint (360). Look for "weight", "peso", "g", "grams".
- "balance": one of "head-heavy", "balanced", "head-light" or null. "High balance"/"alto"=head-heavy. "Medium"/"medio"=balanced. "Low"/"bajo"/"medium-low"=head-light.
- "image_url": direct URL to the best product image. Prefer URLs from [PRODUCT IMAGES] section or og:image meta tag. Must be a full URL starting with https://.
- "product_url": the canonical product page URL or null
- "surface_material": material description (e.g. "Carbon fiber", "3K carbon") or null

Respond ONLY with a JSON object. Use null for fields you can't determine with confidence.

Page content:
${pageContent}`,
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
      surface_material: typeof parsed.surface_material === 'string' ? parsed.surface_material.trim() : null,
    }

    return Response.json({ specs: result })
  } catch (e) {
    console.error('[Extract Racket] Error:', e)
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
