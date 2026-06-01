// src/app/api/ads/impression/route.ts
// Public endpoint — increments today's impression counter for (slot, sponsor).
// Fire-and-forget; uses the atomic increment_ad_impression RPC.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const slot: string | undefined = body?.slot
  const sponsorId: string | undefined = body?.sponsorId

  if (!slot || !sponsorId) {
    return NextResponse.json({ error: 'Missing slot or sponsorId' }, { status: 400 })
  }

  const supabase = createServerClient()
  // Await so the counter increments before a serverless function can freeze
  // after responding. Best-effort: never fail the response on a tracking error.
  try {
    await supabase.rpc('increment_ad_impression', {
      p_slot: slot,
      p_sponsor_id: sponsorId,
    })
  } catch {
    // swallow — tracking is non-critical
  }

  return NextResponse.json({ ok: true })
}
