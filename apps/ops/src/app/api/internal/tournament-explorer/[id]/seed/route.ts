// apps/ops/src/app/api/internal/tournament-explorer/[id]/seed/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { seedTournamentViaLegacy } from '@/lib/seed-fip-bridge'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const result = await seedTournamentViaLegacy({ tournamentId: id })
  if (!result.ok) {
    return NextResponse.json(result, { status: 502 })
  }
  return NextResponse.json(result)
}
