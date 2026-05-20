// apps/ops/src/app/api/internal/today/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getTodayPayload } from '@/lib/today-aggregator'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const payload = await getTodayPayload()
  return NextResponse.json(payload, {
    headers: { 'cache-control': 'no-store' },
  })
}
