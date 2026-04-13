// src/app/api/ops/rackets/route.ts
// Padel rackets CRUD API for ops dashboard.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// -- Auth ────────────────────────────────────────────────────────
async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[Ops Auth] CRON_SECRET env var is not set')
    return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  }
  if (token !== cronSecret) {
    console.error('[Ops Auth] Token mismatch', { hasToken: !!token, tokenLength: token?.length })
    return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  }
  return null
}

// -- GET: List rackets with brand info, optionally filtered by brand_id ──
export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const brandId = url.searchParams.get('brand_id')

  let query = supabase
    .from('padel_rackets')
    .select('*, brand:padel_brands(id, name, logo_url)')
    .order('year', { ascending: false })
    .order('model')

  if (brandId) {
    query = query.eq('brand_id', brandId)
  }

  const { data: rackets, error } = await query

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ rackets: rackets ?? [] })
}

// -- POST: Create a racket ────────────────────────────────────────
export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json() as {
    brand_id?: string
    model?: string
    year?: number
    shape?: string
    weight_grams?: number
    balance?: string
    surface_material?: string
    image_url?: string
    product_url?: string
  }

  const { brand_id, model, year, shape, weight_grams, balance, surface_material, image_url, product_url } = body

  if (!brand_id || typeof brand_id !== 'string') {
    return Response.json({ error: 'Missing required field: brand_id' }, { status: 400 })
  }
  if (!model || typeof model !== 'string' || model.trim() === '') {
    return Response.json({ error: 'Missing required field: model' }, { status: 400 })
  }

  const { data: racket, error } = await supabase
    .from('padel_rackets')
    .insert({
      brand_id,
      model: model.trim(),
      year: year ?? null,
      shape: shape ?? null,
      weight_grams: weight_grams ?? null,
      balance: balance ?? null,
      surface_material: surface_material ?? null,
      image_url: image_url ?? null,
      product_url: product_url ?? null,
    })
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ racket }, { status: 201 })
}

// -- PATCH: Update a racket ───────────────────────────────────────
export async function PATCH(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json() as { id?: string; updates?: Record<string, unknown> }
  const { id, updates } = body

  if (!id || !updates || Object.keys(updates).length === 0) {
    return Response.json({ error: 'Missing required fields: id, updates (non-empty)' }, { status: 400 })
  }

  // Strip fields callers shouldn't overwrite directly
  const { id: _id, ...safeUpdates } = updates as Record<string, unknown>
  void _id

  const { data: racket, error } = await supabase
    .from('padel_rackets')
    .update(safeUpdates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  if (!racket) {
    return Response.json({ error: 'Racket not found' }, { status: 404 })
  }

  return Response.json({ racket })
}
