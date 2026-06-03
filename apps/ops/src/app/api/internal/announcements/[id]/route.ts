// apps/ops/src/app/api/internal/announcements/[id]/route.ts
// GET / PUT / DELETE a single announcement. Auth: Auth.js session (isOperator).
// PUT bumps updated_at so dismissals reset when copy changes.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const ALLOWED_TYPES = ['info', 'warning', 'critical'] as const
type AnnouncementType = (typeof ALLOWED_TYPES)[number]

// Mirror of the caps in ../route.ts.
const MAX_MESSAGE_LEN = 280
const MAX_TITLE_LEN = 60

interface Ctx {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = serviceClient()
  const { id } = await params
  const { data, error } = await supabase
    .from('site_announcements')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ announcement: data })
}

export async function PUT(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params

  let body: {
    title?: string | null
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
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title.length > MAX_TITLE_LEN) {
    return NextResponse.json({ error: `title must be ${MAX_TITLE_LEN} characters or fewer` }, { status: 400 })
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
    .update({
      title: title || null,
      message: body.message.trim(),
      type: body.type,
      active: body.active === true,
      starts_at: body.starts_at || null,
      expires_at: body.expires_at || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }
  return NextResponse.json({ announcement: data })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = serviceClient()
  const { id } = await params
  const { error } = await supabase.from('site_announcements').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
