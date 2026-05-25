// apps/ops/src/app/api/internal/tournament-explorer/list/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getActiveTournamentList } from '@/lib/tournament-list-aggregator'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const tournaments = await getActiveTournamentList()
  return NextResponse.json({ tournaments }, { headers: { 'cache-control': 'no-store' } })
}
