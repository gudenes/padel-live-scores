import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface SuggestionRow {
  id: string
  url: string
  note: string | null
  suggested_by_email: string | null
  status: string
  created_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  approved_source_id: string | null
  submitted_by_kind: 'user' | 'ai_discovery'
  detected_type: string | null
  detected_payload: { name?: string; language?: string; sample?: Array<{ title: string }>; notes?: string } | null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { rows } = await pgPool().query<SuggestionRow>(`
    SELECT id, url, note, suggested_by_email, status, created_at,
           reviewed_by, reviewed_at, review_note, approved_source_id,
           submitted_by_kind, detected_type, detected_payload
    FROM news_source_suggestions
    WHERE status = 'pending'
    ORDER BY created_at DESC
    LIMIT 200
  `)
  return NextResponse.json({ suggestions: rows }, { headers: { 'cache-control': 'no-store' } })
}

interface PatchBody {
  id: string
  status: 'approved' | 'rejected' | 'duplicate'
  review_note?: string | null
  approved_source_id?: string | null
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await req.json()) as PatchBody
  if (!body.id) return NextResponse.json({ error: 'missing id' }, { status: 400 })
  if (!['approved', 'rejected', 'duplicate'].includes(body.status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  }
  try {
    const { rowCount } = await pgPool().query(
      `
      UPDATE news_source_suggestions
      SET status = $1,
          review_note = $2,
          reviewed_by = $3,
          reviewed_at = now(),
          approved_source_id = $4
      WHERE id = $5
    `,
      [body.status, body.review_note ?? null, session.user.email ?? null, body.approved_source_id ?? null, body.id]
    )
    if (rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
