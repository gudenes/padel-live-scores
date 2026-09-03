// Operator-gated JSON wrapper around getMatchScoreboard, used by the
// Tournament Explorer match drawer.
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getMatchScoreboard } from '@/app/(app)/today/_lib/scoreboard-data'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const id = new URL(req.url).searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }
  const match = await getMatchScoreboard(id)
  if (!match) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return NextResponse.json({ match }, { headers: { 'cache-control': 'no-store' } })
}
