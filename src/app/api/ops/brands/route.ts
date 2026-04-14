// src/app/api/ops/brands/route.ts
// Padel equipment brands CRUD API for ops dashboard.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// -- GET: List all brands ordered by name, with racket count ─────
export async function GET() {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { data: brands, error } = await supabase
    .from('padel_brands')
    .select('*, racket_count:padel_rackets(count)')
    .order('name')

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Flatten the count from the nested aggregate
  const normalised = (brands ?? []).map((b: Record<string, unknown>) => {
    const countArr = b.racket_count as { count: number }[] | null
    return {
      ...b,
      racket_count: countArr?.[0]?.count ?? 0,
    }
  })

  return Response.json({ brands: normalised })
}

// -- POST: Create a brand ─────────────────────────────────────────
export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json() as { name?: string; logo_url?: string; website_url?: string }
  const { name, logo_url, website_url } = body

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return Response.json({ error: 'Missing required field: name' }, { status: 400 })
  }

  const { data: brand, error } = await supabase
    .from('padel_brands')
    .insert({ name: name.trim(), logo_url: logo_url ?? null, website_url: website_url ?? null })
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ brand }, { status: 201 })
}

// -- PATCH: Update a brand ────────────────────────────────────────
export async function PATCH(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json() as { id?: string; updates?: Record<string, unknown> }
  const { id, updates } = body

  if (!id || !updates || Object.keys(updates).length === 0) {
    return Response.json({ error: 'Missing required fields: id, updates (non-empty)' }, { status: 400 })
  }

  // Strip fields that callers shouldn't be able to overwrite directly
  const { id: _id, ...safeUpdates } = updates as Record<string, unknown>
  void _id

  const { data: brand, error } = await supabase
    .from('padel_brands')
    .update(safeUpdates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  if (!brand) {
    return Response.json({ error: 'Brand not found' }, { status: 404 })
  }

  return Response.json({ brand })
}
