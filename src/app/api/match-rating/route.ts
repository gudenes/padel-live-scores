// src/app/api/match-rating/route.ts
// Upsert match ratings for authenticated and anonymous users.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.matchId || !body?.rating) {
    return NextResponse.json({ error: 'Missing matchId or rating' }, { status: 400 })
  }

  const rating = Number(body.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be 1-5' }, { status: 400 })
  }

  const matchId: string = body.matchId
  const deviceId: string | undefined = body.deviceId
  const supabase = createServerClient()

  // Check for authenticated user via Authorization header
  let userId: string | null = null
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anonClient.auth.getUser(token)
    userId = user?.id ?? null
  }

  if (!userId && !deviceId) {
    return NextResponse.json({ error: 'Must provide deviceId or auth token' }, { status: 400 })
  }

  // Upsert the rating
  if (userId) {
    // Authenticated: upsert by user_id, also clear any anonymous rating from same device
    const { error } = await supabase
      .from('match_ratings')
      .upsert(
        { match_id: matchId, user_id: userId, device_id: null, rating, updated_at: new Date().toISOString() },
        { onConflict: 'match_id,user_id' }
      )
    if (error) {
      console.error('[match-rating] upsert error:', error)
      return NextResponse.json({ error: 'Failed to save rating' }, { status: 500 })
    }
    // Clean up anonymous rating for this device+match if it exists
    if (deviceId) {
      await supabase
        .from('match_ratings')
        .delete()
        .eq('match_id', matchId)
        .eq('device_id', deviceId)
        .is('user_id', null)
    }
  } else {
    // Anonymous: upsert by device_id
    const { error } = await supabase
      .from('match_ratings')
      .upsert(
        { match_id: matchId, device_id: deviceId, user_id: null, rating, updated_at: new Date().toISOString() },
        { onConflict: 'match_id,device_id' }
      )
    if (error) {
      console.error('[match-rating] upsert error:', error)
      return NextResponse.json({ error: 'Failed to save rating' }, { status: 500 })
    }
  }

  // Return fresh aggregates (trigger has already updated them)
  const { data: match } = await supabase
    .from('matches')
    .select('avg_rating, rating_count')
    .eq('id', matchId)
    .single()

  return NextResponse.json({
    ok: true,
    avg_rating: match?.avg_rating ?? null,
    rating_count: match?.rating_count ?? 0,
  })
}
