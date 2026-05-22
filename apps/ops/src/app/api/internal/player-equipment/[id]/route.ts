// apps/ops/src/app/api/internal/player-equipment/[id]/route.ts
// DELETE handler for a single player_equipment assignment. Two modes:
//   - `?end=true` → SOFT END: sets `ended_at` to today (YYYY-MM-DD), preserves
//     the row so equipment history stays intact. Use this when a player
//     legitimately stopped using a racket.
//   - (no `?end`)  → HARD DELETE: removes the row outright. Use this when the
//     assignment was created in error and should leave no trace.
//
// Idempotent by design: Supabase's `.update().eq()` and `.delete().eq()` both
// succeed when zero rows match the filter, so re-calling with a stale id is a
// no-op rather than a 404. The route unblocks the "End assignment" button in
// the new drawer Equipment tab (Plan 4, Task B1).
//
// Auth: Auth.js session with isOperator flag (matches Task A1 pattern).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: 'Missing required param: id' }, { status: 400 })
  }

  const url = new URL(request.url)
  const endMode = url.searchParams.get('end') === 'true'

  const supabase = serviceClient()

  if (endMode) {
    // ended_at is a DATE column — store YYYY-MM-DD to match the sibling
    // route.ts POST/PUT/PATCH handlers that compute it the same way.
    const today = new Date().toISOString().slice(0, 10)
    const { error } = await supabase
      .from('player_equipment')
      .update({ ended_at: today })
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } else {
    const { error } = await supabase
      .from('player_equipment')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
