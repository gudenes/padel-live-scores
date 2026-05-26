// apps/ops/src/app/api/internal/brands/route.ts
// Padel equipment brands CRUD API for ops dashboard.
// Auth: Auth.js session with isOperator flag.
// Ported from src/app/api/ops/brands/route.ts (Plan 3a hotfix).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { rehostEquipmentImageToSupabase, isSupabaseHosted } from '@/lib/equipment-image-rehost'

// -- GET: List all brands ordered by name, with racket count ─────
export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
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
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { name?: string; logo_url?: string; website_url?: string }
  const { name, logo_url, website_url } = body

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return Response.json({ error: 'Missing required field: name' }, { status: 400 })
  }

  const supabase = serviceClient()
  const { data: brand, error } = await supabase
    .from('padel_brands')
    .insert({ name: name.trim(), logo_url: logo_url ?? null, website_url: website_url ?? null })
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Rehost externally-hosted logo onto Supabase Storage. Failure here does
  // NOT fail the create — the row keeps the original URL and ops can retry.
  if (brand.logo_url && !isSupabaseHosted(brand.logo_url)) {
    const rehost = await rehostEquipmentImageToSupabase(supabase, 'brand', brand.id, brand.logo_url)
    if (rehost.status === 'ok' && rehost.newUrl) {
      brand.logo_url = rehost.newUrl
    }
  }

  return Response.json({ brand }, { status: 201 })
}

// -- PATCH: Update a brand ────────────────────────────────────────
export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { id?: string; updates?: Record<string, unknown> }
  const { id, updates } = body

  if (!id || !updates || Object.keys(updates).length === 0) {
    return Response.json({ error: 'Missing required fields: id, updates (non-empty)' }, { status: 400 })
  }

  // Strip fields that callers shouldn't be able to overwrite directly
  const { id: _id, ...safeUpdates } = updates as Record<string, unknown>
  void _id

  const supabase = serviceClient()
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

  // Rehost externally-hosted logo onto Supabase Storage. Failure here does
  // NOT fail the update — the row keeps the original URL and ops can retry.
  if (brand.logo_url && !isSupabaseHosted(brand.logo_url)) {
    const rehost = await rehostEquipmentImageToSupabase(supabase, 'brand', brand.id, brand.logo_url)
    if (rehost.status === 'ok' && rehost.newUrl) {
      brand.logo_url = rehost.newUrl
    }
  }

  return Response.json({ brand })
}
