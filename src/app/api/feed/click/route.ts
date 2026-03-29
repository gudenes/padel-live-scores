// src/app/api/feed/click/route.ts
// Lightweight endpoint to track article clicks for popularity scoring.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id = body?.id
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Missing article id' }, { status: 400 })
  }

  const supabase = createServerClient()
  await supabase.rpc('increment_article_clicks', { article_id: id })

  return NextResponse.json({ ok: true })
}
