// apps/ops/src/app/api/internal/managed-events/[id]/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { isValidSlug, buildWritablePayload } from '@/types/managed-events'

const COLUMNS =
  'id, slug, name, wordmark, badge_label, active, status_override, country, location, venue, starts_at, ends_at, prize_pool, cover_image_url, ticket_url, footnote, watch_links, divisions, format, results, sort_weight, updated_at, created_at'

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = serviceClient()
  const { id } = await params
  const { data, error } = await supabase.from('managed_events').select(COLUMNS).eq('id', id).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Event not found' }, { status: 404 })
  return Response.json({ event: data })
}

export async function PUT(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = serviceClient()
  const { id } = await params

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const updates = buildWritablePayload(body)
  if (typeof body.name === 'string') {
    if (!body.name.trim()) return Response.json({ error: 'name cannot be empty' }, { status: 400 })
    updates.name = body.name.trim()
  }
  if (typeof body.slug === 'string') {
    const slug = body.slug.trim()
    if (!isValidSlug(slug)) return Response.json({ error: 'slug must be kebab-case' }, { status: 400 })
    const { data: clash } = await supabase.from('managed_events').select('id').eq('slug', slug).neq('id', id).maybeSingle()
    if (clash) return Response.json({ error: `slug "${slug}" is already in use` }, { status: 409 })
    updates.slug = slug
  }
  updates.updated_at = new Date().toISOString()

  const { data: updated, error } = await supabase.from('managed_events').update(updates).eq('id', id).select(COLUMNS).single()
  if (error || !updated) return Response.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  return Response.json({ event: updated })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = serviceClient()
  const { id } = await params
  const { error } = await supabase.from('managed_events').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
