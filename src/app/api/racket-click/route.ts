// src/app/api/racket-click/route.ts
// Public endpoint — tracks affiliate link clicks on padel rackets.
// Routes clicks from the user's country to the active country partner if one exists.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'
import {
  resolveRacketDestination,
  getActivePartnerForCountry,
  getPerRacketUrl,
} from '@/lib/racket-partner-resolver'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const racketId: string | undefined = body?.racket_id
  const playerId: string | undefined = body?.player_id

  if (!racketId || typeof racketId !== 'string') {
    return NextResponse.json({ error: 'Missing racket_id' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: racket, error } = await supabase
    .from('padel_rackets')
    .select('id, product_url, click_count')
    .eq('id', racketId)
    .single()

  if (error || !racket) {
    return NextResponse.json({ error: 'Racket not found' }, { status: 404 })
  }

  const country = req.cookies.get('geo-country')?.value ?? null
  const partner = await getActivePartnerForCountry(supabase, country)
  const perRacketUrl = partner ? await getPerRacketUrl(supabase, racketId, partner.id) : null

  const resolved = resolveRacketDestination({
    country,
    partner,
    perRacketUrl,
    originalProductUrl: racket.product_url,
  })

  if (!resolved.url) {
    return NextResponse.json({ error: 'No product URL for this racket' }, { status: 404 })
  }

  const session = await auth()
  const userId = session?.user?.id ?? null

  // Supabase queries are lazy — they only run when awaited. Record the click
  // and bump the counter in parallel; a tracking failure never blocks the redirect.
  const [clickInsert, countUpdate] = await Promise.all([
    supabase.from('racket_clicks').insert({
      racket_id: racketId,
      player_id: playerId ?? null,
      user_id: userId,
      country_code: country,
      partner_id: resolved.partnerId,
      resolved_url: resolved.url,
    }),
    supabase
      .from('padel_rackets')
      .update({ click_count: (racket.click_count ?? 0) + 1 })
      .eq('id', racketId),
  ])
  if (clickInsert.error) console.error('[racket-click] insert failed', clickInsert.error)
  if (countUpdate.error) console.error('[racket-click] click_count update failed', countUpdate.error)

  return NextResponse.json({ url: resolved.url })
}
