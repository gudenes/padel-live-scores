import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const kind = req.nextUrl.searchParams.get('kind')
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '10', 10), 50)
  if (!kind) return NextResponse.json({ error: 'missing kind' }, { status: 400 })

  const { rows } = await pgPool().query(
    `SELECT id, kind, metadata, created_at FROM ops_events WHERE kind = $1 ORDER BY created_at DESC LIMIT $2`,
    [kind, limit],
  )
  return NextResponse.json({ events: rows })
}
