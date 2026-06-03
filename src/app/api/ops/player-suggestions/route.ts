// src/app/api/ops/player-suggestions/route.ts
// Ops: list player suggestions. Defaults to pending, newest first.
// Pass ?status=all to include reviewed items (last 100).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { checkOpsAuth } from '@/lib/ops-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const status = req.nextUrl.searchParams.get('status') ?? 'pending'
  const supabase = createServerClient()

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
