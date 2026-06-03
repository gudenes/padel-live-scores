// apps/ops/src/app/api/internal/player-suggestions/route.ts
// Admin: list crowd-sourced player suggestions. Defaults to pending, newest
// first. Pass ?status=all to include reviewed items (last 100).
// Auth: Auth.js session with isOperator check (same as other /api/internal/*).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const status = new URL(request.url).searchParams.get('status') ?? 'pending'
  const supabase = serviceClient()

  let query = supabase
    .from('player_suggestions')
    .select('id, player_id, player_name, changes, comment, submitted_by_email, submitted_by_user_id, status, created_at, reviewed_at, review_note')
    .order('created_at', { ascending: false })
    .limit(100)

  if (status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ items: data ?? [] })
}
