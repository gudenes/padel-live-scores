// apps/ops/src/app/api/internal/players/merge/route.ts
// Merge two duplicate players: keep one, reassign FKs, delete the other.
// Auth: Auth.js session — requires isOperator flag on the session user.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

// -- POST: Merge two players ─────────────────────────────────────
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  const body = await request.json()
  const { keepId, deleteId, mergedFields } = body as {
    keepId: string
    deleteId: string
    mergedFields: Record<string, unknown>
  }

  if (!keepId || !deleteId) {
    return Response.json({ error: 'Missing required fields: keepId, deleteId' }, { status: 400 })
  }

  if (keepId === deleteId) {
    return Response.json({ error: 'keepId and deleteId must be different' }, { status: 400 })
  }

  // 1. Update kept player with merged fields
  if (mergedFields && Object.keys(mergedFields).length > 0) {
    const { error } = await supabase
      .from('players')
      .update(mergedFields)
      .eq('id', keepId)

    if (error) {
      return Response.json({ error: `Failed to update kept player: ${error.message}` }, { status: 500 })
    }
  }

  // 2. Reassign match FKs: replace deleteId -> keepId across all 4 columns
  let matchesUpdated = 0
  const matchFkColumns = [
    'pair1_player1_id',
    'pair1_player2_id',
    'pair2_player1_id',
    'pair2_player2_id',
  ] as const

  for (const col of matchFkColumns) {
    const { data, error } = await supabase
      .from('matches')
      .update({ [col]: keepId })
      .eq(col, deleteId)
      .select('id')

    if (error) {
      return Response.json({ error: `Failed to update matches.${col}: ${error.message}` }, { status: 500 })
    }
    matchesUpdated += data?.length ?? 0
  }

  // 3. Reassign tournament_draws FKs: player1_id and player2_id
  let drawsUpdated = 0

  for (const col of ['player1_id', 'player2_id'] as const) {
    const { data, error } = await supabase
      .from('tournament_draws')
      .update({ [col]: keepId })
      .eq(col, deleteId)
      .select('id')

    if (error) {
      return Response.json({ error: `Failed to update tournament_draws.${col}: ${error.message}` }, { status: 500 })
    }
    drawsUpdated += data?.length ?? 0
  }

  // 4. Delete the duplicate player
  const { error: deleteError } = await supabase
    .from('players')
    .delete()
    .eq('id', deleteId)

  if (deleteError) {
    return Response.json({ error: `Failed to delete duplicate player: ${deleteError.message}` }, { status: 500 })
  }

  return Response.json({
    matchesUpdated,
    drawsUpdated,
    deleted: true,
  })
}
