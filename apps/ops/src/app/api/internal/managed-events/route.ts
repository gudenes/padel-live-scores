// apps/ops/src/app/api/internal/managed-events/route.ts
// List + create managed events. Auth: Auth.js session (isOperator).
// Writes via the service-key client (bypasses RLS).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { isValidSlug, buildWritablePayload } from '@/types/managed-events'

const COLUMNS =
  'id, slug, name, wordmark, badge_label, active, status_override, country, location, venue, starts_at, ends_at, prize_pool, cover_image_url, ticket_url, footnote, watch_links, divisions, format, results, sort_weight, updated_at, created_at'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('managed_events')
    .select(COLUMNS)
    .order('updated_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ events: data ?? [] })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = serviceClient()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  if (!name) return Response.json({ error: 'name is required' }, { status: 400 })
  if (!slug || !isValidSlug(slug)) {
    return Response.json({ error: 'slug must be kebab-case (a-z, 0-9, dashes)' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('managed_events').select('id').eq('slug', slug).maybeSingle()
  if (existing) return Response.json({ error: `slug "${slug}" is already in use` }, { status: 409 })

  const insert = buildWritablePayload(body)
  insert.name = name
  insert.slug = slug

  const { data: inserted, error } = await supabase
    .from('managed_events').insert(insert).select(COLUMNS).single()
  if (error || !inserted) return Response.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  return Response.json({ event: inserted })
}
