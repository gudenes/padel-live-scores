// src/app/api/ads/click/route.ts
// Public endpoint — logs a sponsor ad click. Fire-and-forget insert; the
// browser already has the destination URL from sponsor config, so this route
// only records the event and returns { ok: true }.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const slot: string | undefined = body?.slot
  const sponsorId: string | undefined = body?.sponsorId
  const matchId: string | undefined = body?.matchId

  if (!slot || !sponsorId) {
    return NextResponse.json({ error: 'Missing slot or sponsorId' }, { status: 400 })
  }

  const session = await auth()
  const userId = session?.user?.id ?? null
  const cookieStore = await cookies()
  const locale = cookieStore.get('NEXT_LOCALE')?.value ?? null

  const supabase = createServerClient()
  // Await the write so the row lands before a serverless function can freeze
  // after responding — accurate click counts are the point of this route.
  // Best-effort: never fail the response on a tracking error.
  try {
    await supabase.from('ad_clicks').insert({
      slot,
      sponsor_id: sponsorId,
      match_id: matchId ?? null,
      user_id: userId,
      locale,
    })
  } catch {
    // swallow — tracking is non-critical
  }

  return NextResponse.json({ ok: true })
}
