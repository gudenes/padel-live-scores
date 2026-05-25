// apps/ops/src/app/api/internal/tournament-explorer/[id]/link-fip-twin/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { linkFipTwin } from '@/lib/fip-twin-finder'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  let body: { sourceTournamentId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.sourceTournamentId || typeof body.sourceTournamentId !== 'string') {
    return NextResponse.json({ error: 'missing sourceTournamentId' }, { status: 400 })
  }
  try {
    await linkFipTwin({ targetTournamentId: id, sourceTournamentId: body.sourceTournamentId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'link failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
