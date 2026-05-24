// apps/ops/src/app/api/news-sources/detect/route.ts
// Detector endpoint — called by Add Source drawer, public submission endpoint,
// and AI discovery candidate verifier. Admin-authed. Synchronous. ~15s max.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { detectSource } from '@/lib/source-detector'
import { logOpsEvent } from '@/lib/news-events'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest | Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { url?: string }
  const url = (body.url ?? '').trim()
  if (!url || !/^https?:\/\/.+/.test(url) || url.length > 500) {
    return NextResponse.json({ error: 'invalid_url' }, { status: 400 })
  }

  try {
    const result = await detectSource(url)
    if (result.type === 'unknown') {
      await logOpsEvent('news_source.detect.failed', { url, reason: result.notes ?? 'unknown' })
    } else {
      await logOpsEvent('news_source.detect.success', {
        url,
        type: result.type,
        name: result.name,
        language: result.language,
        sample_count: result.sample.length,
      })
    }
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: 'fetch_failed', message: (e as Error).message }, { status: 502 })
  }
}
