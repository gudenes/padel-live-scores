// src/app/api/road-to-olympics/pledges/count/route.ts
//
// GET handler for the public pledge count. Used by <PledgeInline /> for
// the inline counter and for client-side refresh after submitting a pledge.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
  const { count, error } = await supabase
    .from('road_to_olympics_pledges')
    .select('*', { count: 'exact', head: true })
  if (error) {
    console.error('[road-to-olympics] pledge count failed:', error)
    return NextResponse.json({ count: 0 }, { status: 200 })
  }
  return NextResponse.json({ count: count ?? 0 })
}
