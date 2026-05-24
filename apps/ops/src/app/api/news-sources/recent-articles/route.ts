import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sourceId = req.nextUrl.searchParams.get('source_id')
  if (!sourceId) return NextResponse.json({ error: 'missing source_id' }, { status: 400 })

  const { rows } = await pgPool().query<{ title: string; published_at: string }>(`
    SELECT title, published_at FROM articles
    WHERE source_id = $1
    ORDER BY published_at DESC
    LIMIT 10
  `, [sourceId])
  return NextResponse.json({ articles: rows })
}
