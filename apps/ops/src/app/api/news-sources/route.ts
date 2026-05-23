// apps/ops/src/app/api/news-sources/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  listNewsSources,
  createNewsSource,
  updateNewsSource,
  type CreateNewsSourceInput,
  type UpdateNewsSourceInput,
} from '@/lib/news-sources-queries'

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
  const body = await req.json() as Partial<CreateNewsSourceInput>
  for (const f of ['key', 'name', 'url', 'source_type', 'language', 'cadence'] as const) {
    if (!body[f]) return NextResponse.json({ error: `missing field: ${f}` }, { status: 400 })
  }
  try {
    const source = await createNewsSource({
      ...body as CreateNewsSourceInput,
      created_by: session.user.email ?? 'unknown',
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
    return NextResponse.json({ source })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
