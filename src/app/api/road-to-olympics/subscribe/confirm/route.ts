// src/app/api/road-to-olympics/subscribe/confirm/route.ts
//
// GET handler for double-opt-in confirmation. Token comes from the email's
// CTA URL. On success we redirect to /road-to-olympics?subscribed=1.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(new URL('/road-to-olympics?subscribed=invalid', req.url))
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )

  const { data, error } = await supabase
    .from('road_to_olympics_subscribers')
    .update({ confirmed_at: new Date().toISOString(), confirm_token: null })
    .eq('confirm_token', token)
    .is('confirmed_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[road-to-olympics] subscribe confirm failed:', error)
    return NextResponse.redirect(new URL('/road-to-olympics?subscribed=error', req.url))
  }
  if (!data) {
    return NextResponse.redirect(new URL('/road-to-olympics?subscribed=expired', req.url))
  }
  return NextResponse.redirect(new URL('/road-to-olympics?subscribed=1', req.url))
}
