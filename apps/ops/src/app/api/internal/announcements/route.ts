// apps/ops/src/app/api/internal/announcements/route.ts
// List + create site announcements. Auth: Auth.js session (isOperator).
// All writes go through the service-key client (bypasses RLS). Mirrors the
// shape of /api/internal/news.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const ALLOWED_TYPES = ['info', 'warning', 'critical'] as const
type AnnouncementType = (typeof ALLOWED_TYPES)[number]

// Keep banner copy to one short line — long text produces a tall bar that
// shoves all page content down. Operator-facing guard, not a security boundary.
const MAX_MESSAGE_LEN = 280

// GET: list all announcements, newest first.
export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('site_announcements')
    .select('id, message, type, active, starts_at, expires_at, updated_at, created_at')
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ announcements: data ?? [] })
}

// POST: create a new announcement.
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: {
    message?: string
    type?: string
    active?: boolean
    starts_at?: string | null
    expires_at?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }
  if (body.message.trim().length > MAX_MESSAGE_LEN) {
    return NextResponse.json({ error: `message must be ${MAX_MESSAGE_LEN} characters or fewer` }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(body.type as AnnouncementType)) {
    return NextResponse.json(
      { error: `type must be one of ${ALLOWED_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('site_announcements')
    .insert({
      message: body.message.trim(),
      type: body.type,
      active: body.active === true,
      starts_at: body.starts_at || null,
      expires_at: body.expires_at || null,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }
  return NextResponse.json({ announcement: data })
}
