// src/app/api/racket-click/route.ts
// Public endpoint — tracks affiliate link clicks on padel rackets from the player profile page.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

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

  if (error || !racket || !racket.product_url) {
    return NextResponse.json({ error: 'Racket not found or has no product URL' }, { status: 404 })
  }

  // Try to get the current user session for user_id tracking
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id ?? null

  // Fire-and-forget: insert click record
  void supabase
    .from('racket_clicks')
    .insert({ racket_id: racketId, player_id: playerId ?? null, user_id: userId })

  // Fire-and-forget: increment click_count
  void supabase
    .from('padel_rackets')
    .update({ click_count: (racket.click_count ?? 0) + 1 })
    .eq('id', racketId)

  return NextResponse.json({ url: racket.product_url })
}
