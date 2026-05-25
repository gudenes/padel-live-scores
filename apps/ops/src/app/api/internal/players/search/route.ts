// apps/ops/src/app/api/internal/players/search/route.ts
//
// GET search for players by name, scoped by category. Used by the
// ResolvePartnerModal's Link tab.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const category = url.searchParams.get('category') === 'women' ? 'women' : 'men'
  const perPage = Math.min(50, Math.max(1, parseInt(url.searchParams.get('per_page') ?? '25', 10)))

  if (!q) {
    return NextResponse.json({ error: 'q is required' }, { status: 400 })
  }

  const res = await pgPool().query(
    `select id, name, country, ranking, fip_id
       from public.players
      where name ilike $1
        and category = $2
      order by ranking nulls last
      limit $3`,
    [`%${q}%`, category, perPage],
  )
  return NextResponse.json({ players: res.rows }, { headers: { 'cache-control': 'no-store' } })
}
