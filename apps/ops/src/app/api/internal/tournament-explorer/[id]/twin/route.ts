// apps/ops/src/app/api/internal/tournament-explorer/[id]/twin/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { findFipTwin } from '@/lib/fip-twin-finder'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const twin = await findFipTwin(id)
  return NextResponse.json({ twin })
}
