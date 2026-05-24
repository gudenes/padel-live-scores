import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getQualityDistribution } from '@/lib/news-sources-queries'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const buckets = await getQualityDistribution()
  return NextResponse.json({ buckets })
}
