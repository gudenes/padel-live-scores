// apps/ops/src/app/api/internal/player-suggestions/count/route.ts
// Lightweight pending-count for the Rail nudge badge. Head-only count query.
// Auth: Auth.js session with isOperator check.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const { count, error } = await supabase
    .from('player_suggestions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ count: count ?? 0 })
}
