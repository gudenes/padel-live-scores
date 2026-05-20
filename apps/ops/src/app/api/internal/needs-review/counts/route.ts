// apps/ops/src/app/api/internal/needs-review/counts/route.ts
// GET → sidebar badge poll. Lives outside (app)/ so we gate explicitly
// via auth() rather than rely on the layout-level operator check.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getNeedsReviewCounts } from '@/lib/needs-review-counts'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const counts = await getNeedsReviewCounts()
  return NextResponse.json(counts, {
    headers: { 'cache-control': 'no-store' },
  })
}
