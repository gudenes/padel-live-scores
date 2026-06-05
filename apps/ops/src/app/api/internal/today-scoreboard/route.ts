// apps/ops/src/app/api/internal/today-scoreboard/route.ts
// Operator-gated JSON wrapper around the server-only getScoreboardSnapshot, so the
// Today client island can re-fetch fresh snapshots. Auth mirrors api/internal/today.
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getScoreboardSnapshot } from '@/app/(app)/today/_lib/scoreboard-data'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  return NextResponse.json(await getScoreboardSnapshot(date), {
    headers: { 'cache-control': 'no-store' },
  })
}
