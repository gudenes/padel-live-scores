// apps/ops/src/app/api/internal/youtube-channels/[id]/route.ts
//
// PATCH  update editable fields (name, abbreviation, colorHex,
//        displayOrder, isActive). channel_id and uploads_playlist_id
//        are immutable — re-add to "change" a channel.
// DELETE cascade-delete the channel + its youtube_channel_live rows.
//
// Auth: Auth.js session with isOperator flag.
// Ported from src/app/api/ops/youtube-channels/[id]/route.ts (Plan 3b-extra Task 3).

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

interface PatchBody {
  name?: string
  abbreviation?: string
  colorHex?: string
  displayOrder?: number
  isActive?: boolean
}

interface Ctx {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  let body: PatchBody
  try { body = (await request.json()) as PatchBody }
  catch { return NextResponse.json({ error: 'invalid json body' }, { status: 400 }) }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) update.name = body.name
  if (body.abbreviation !== undefined) update.abbreviation = body.abbreviation
  if (body.colorHex !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(body.colorHex)) {
      return NextResponse.json({ error: 'colorHex must be a 6-digit hex' }, { status: 400 })
    }
    update.color_hex = body.colorHex
  }
  if (body.displayOrder !== undefined) update.display_order = body.displayOrder
  if (body.isActive !== undefined) update.is_active = body.isActive

  const supabase = serviceClient()

  const { data, error } = await supabase
    .from('youtube_channels')
    .update(update)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ channel: data })
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const supabase = serviceClient()
  const { error } = await supabase.from('youtube_channels').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
