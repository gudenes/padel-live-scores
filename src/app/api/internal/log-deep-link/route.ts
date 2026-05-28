// src/app/api/internal/log-deep-link/route.ts
// Public-ish endpoint (any signed-in user can call) that logs a
// news_feed.deep_link_open ops_event. Called fire-and-forget from
// the home rail / overlay when a deep-link opens.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface Body {
  origin?: 'home_rail' | 'direct_url' | 'foryou_sibling'
  article_id?: string
  cluster_size?: number
}

const VALID_ORIGINS = new Set(['home_rail', 'direct_url', 'foryou_sibling'])

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Body
  if (!body.article_id || !body.origin || !VALID_ORIGINS.has(body.origin)) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  }
  const supabase = createServerClient()
  await supabase.from('ops_events').insert({
    source: 'news_feed.deep_link_open',
    status: 'ok',
    meta: {
      origin: body.origin,
      article_id: body.article_id,
      cluster_size: body.cluster_size ?? 1,
    },
  })
  return NextResponse.json({ ok: true })
}
