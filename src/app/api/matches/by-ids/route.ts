// src/app/api/matches/by-ids/route.ts
//
// Batch-fetch matches by UUID list. Used by the /picks page to hydrate
// localStorage predictions with their current match state.
//
// GET /api/matches/by-ids?ids=uuid1,uuid2,...
// Returns: Match[] (with player + sets sub-selects)

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const idsParam = url.searchParams.get('ids')
  if (!idsParam) return NextResponse.json([])

  const ids = idsParam.split(',').filter(Boolean).slice(0, 200)
  if (ids.length === 0) return NextResponse.json([])

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('matches')
    .select(
      '*, ' +
      'pair1_player1:pair1_player1_id(id, name, country, ranking), ' +
      'pair1_player2:pair1_player2_id(id, name, country, ranking), ' +
      'pair2_player1:pair2_player1_id(id, name, country, ranking), ' +
      'pair2_player2:pair2_player2_id(id, name, country, ranking), ' +
      'sets(*)'
    )
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
