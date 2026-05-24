import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface SuggestionRow {
  id: string
  url: string
  note: string | null
  suggested_by_email: string | null
  created_at: string
  submitted_by_kind: 'user' | 'ai_discovery'
  detected_type: string | null
  detected_payload: { name?: string; language?: string; sample?: Array<{ title: string }>; notes?: string } | null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { rows } = await pgPool().query<SuggestionRow>(
    `SELECT id, url, note, suggested_by_email, created_at,
            submitted_by_kind, detected_type, detected_payload
       FROM news_source_suggestions
      WHERE status = 'pending'
      ORDER BY created_at DESC`,
  )

  return NextResponse.json({ suggestions: rows }, { headers: { 'cache-control': 'no-store' } })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json() as { id: string; status: string; review_note?: string }
  if (!body.id || !body.status) {
    return NextResponse.json({ error: 'missing id or status' }, { status: 400 })
  }

  await pgPool().query(
    `UPDATE news_source_suggestions
        SET status = $1,
            review_note = $2,
            reviewed_by = $3,
            reviewed_at = now()
      WHERE id = $4`,
    [body.status, body.review_note ?? null, session.user.email ?? 'unknown', body.id],
  )

  return NextResponse.json({ ok: true })
}
