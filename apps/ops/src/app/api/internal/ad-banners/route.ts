// apps/ops/src/app/api/internal/ad-banners/route.ts
// Ad banner CRUD for the ops dashboard. Auth: Auth.js operator session.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { mergeBannerStats, type BannerStatRow } from '@/lib/ad-banner-stats'

async function requireOperator() {
  const session = await auth()
  return session?.user?.isOperator ? null : NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

const COLS = 'id, name, country_codes, slot, image_url, click_url, active, weight, created_at, updated_at'

export async function GET() {
  const deny = await requireOperator()
  if (deny) return deny
  const supabase = serviceClient()
  const [{ data, error }, { data: stats }] = await Promise.all([
    supabase.from('ad_banners').select(COLS).order('created_at', { ascending: false }),
    supabase.from('ad_banner_stats').select('banner_id, impressions, clicks'),
  ])
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const banners = mergeBannerStats(data ?? [], (stats ?? []) as BannerStatRow[])
  return Response.json({ banners })
}

interface BannerInput {
  name?: string
  country_codes?: string[]
  slot?: string
  image_url?: string
  click_url?: string
  active?: boolean
  weight?: number
}

function validCountries(v: unknown): string | null {
  if (v == null) return null
  if (!Array.isArray(v)) return 'country_codes must be an array'
  if (!v.every((c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c))) return 'each country must be 2 uppercase letters (e.g. ES)'
  return null
}

function validate(b: BannerInput): string | null {
  if (!b.name || !b.name.trim()) return 'name is required'
  if (!b.image_url || !b.image_url.trim()) return 'image_url is required'
  if (!b.click_url || !b.click_url.trim()) return 'click_url is required'
  const cc = validCountries(b.country_codes)
  if (cc) return cc
  if (b.weight != null && (!Number.isInteger(b.weight) || b.weight < 1)) return 'weight must be an integer >= 1'
  return null
}

// Columns an operator may change via PATCH (allowlist — avoids forwarding
// unknown/typo'd keys to PostgREST and leaking raw column errors).
const PATCHABLE = ['name', 'country_codes', 'slot', 'image_url', 'click_url', 'active', 'weight'] as const

function validatePartial(u: Record<string, unknown>): string | null {
  if ('name' in u && (!u.name || !String(u.name).trim())) return 'name cannot be empty'
  if ('image_url' in u && (!u.image_url || !String(u.image_url).trim())) return 'image_url cannot be empty'
  if ('click_url' in u && (!u.click_url || !String(u.click_url).trim())) return 'click_url cannot be empty'
  if ('country_codes' in u) { const cc = validCountries(u.country_codes); if (cc) return cc }
  if ('weight' in u && (!Number.isInteger(u.weight) || (u.weight as number) < 1)) return 'weight must be an integer >= 1'
  return null
}

export async function POST(request: Request) {
  const deny = await requireOperator()
  if (deny) return deny
  const body = (await request.json().catch(() => ({}))) as BannerInput
  const err = validate(body)
  if (err) return Response.json({ error: err }, { status: 400 })
  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('ad_banners')
    .insert({
      name: body.name!.trim(),
      country_codes: body.country_codes ?? [],
      slot: body.slot ?? 'sticky-bottom',
      image_url: body.image_url!.trim(),
      click_url: body.click_url!.trim(),
      active: body.active ?? true,
      weight: body.weight ?? 1,
    })
    .select(COLS)
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ banner: data })
}

export async function PATCH(request: Request) {
  const deny = await requireOperator()
  if (deny) return deny
  const body = (await request.json().catch(() => ({}))) as { id?: string; updates?: BannerInput }
  if (!body.id) return Response.json({ error: 'id is required' }, { status: 400 })
  const raw = (body.updates ?? {}) as Record<string, unknown>
  const updates: Record<string, unknown> = {}
  for (const k of PATCHABLE) if (k in raw) updates[k] = raw[k]
  const err = validatePartial(updates)
  if (err) return Response.json({ error: err }, { status: 400 })
  updates.updated_at = new Date().toISOString()
  const supabase = serviceClient()
  const { data, error } = await supabase.from('ad_banners').update(updates).eq('id', body.id).select(COLS).single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ banner: data })
}

export async function DELETE(request: Request) {
  const deny = await requireOperator()
  if (deny) return deny
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
  const supabase = serviceClient()
  const { error } = await supabase.from('ad_banners').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
