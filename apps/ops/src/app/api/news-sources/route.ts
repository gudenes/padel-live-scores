// apps/ops/src/app/api/news-sources/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  listNewsSources,
  createNewsSource,
  updateNewsSource,
  approveSuggestionWithSource,
  type CreateNewsSourceInput,
  type UpdateNewsSourceInput,
} from '@/lib/news-sources-queries'
import { logOpsEvent } from '@/lib/news-events'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const sources = await listNewsSources()
  return NextResponse.json({ sources }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = await req.json() as Partial<CreateNewsSourceInput> & { from_suggestion_id?: string }
  for (const f of ['key', 'name', 'url', 'source_type', 'language', 'cadence'] as const) {
    if (!body[f]) return NextResponse.json({ error: `missing field: ${f}` }, { status: 400 })
  }
  try {
    const source = await createNewsSource({
      ...body as CreateNewsSourceInput,
      created_by: session.user.email ?? 'unknown',
    })
    if (body.from_suggestion_id) {
      await approveSuggestionWithSource(body.from_suggestion_id, source.id, session.user.email ?? 'unknown')
    }
    await logOpsEvent('news_source.added', {
      source_key: source.key,
      source_name: source.name,
      source_type: source.source_type,
      added_by_kind: body.from_suggestion_id ? 'suggestion' : 'operator',
    })
    return NextResponse.json({ source })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = await req.json() as UpdateNewsSourceInput
  if (!body.id) return NextResponse.json({ error: 'missing id' }, { status: 400 })
  try {
    const source = await updateNewsSource(body)
    if (!source) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await logOpsEvent('news_source.edited', {
      source_key: source.key,
      fields_changed: Object.keys(body).filter(k => k !== 'id'),
    })
    return NextResponse.json({ source })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
