// src/app/api/racket-click/route.ts
// Public endpoint — tracks affiliate link clicks on padel rackets from the player profile page.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const racketId: string | undefined = body?.racket_id
  const playerId: string | undefined = body?.player_id

  if (!racketId || typeof racketId !== 'string') {
    return NextResponse.json({ error: 'Missing racket_id' }, { status: 400 })
  }

  const supabase = createServerClient()

  // Look up the racket to get product_url
  const { data: racket, error } = await supabase
    .from('padel_rackets')
    .select('id, product_url, click_count')
    .eq('id', racketId)
    .single()

  if (error || !racket) {
    return NextResponse.json({ error: 'Racket not found' }, { status: 404 })
  }

  const session = await auth()
  const userId = session?.user?.id ?? null

  // Persist the click. Tracked even when the racket has no deep product_url —
  // the client falls back to the brand's affiliate store page, so those clicks
  // still earn commission and must be counted. Awaited (not fire-and-forget):
  // the Supabase query builder is a lazy thenable, so an un-awaited `void`
  // builder never actually runs and the write silently vanishes. The click
  // handler already awaits this response, so the added latency is invisible.
  await Promise.allSettled([
    supabase
      .from('racket_clicks')
      .insert({ racket_id: racketId, player_id: playerId ?? null, user_id: userId }),
    supabase
      .from('padel_rackets')
      .update({ click_count: (racket.click_count ?? 0) + 1 })
      .eq('id', racketId),
  ])

  // product_url may be null; the client resolves the brand-store fallback.
  return NextResponse.json({ url: racket.product_url ?? null })
}
