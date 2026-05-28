// apps/ops/src/app/api/internal/trigger-translation-backfill/route.ts
// Server-side proxy: admin button on Discovery Health calls this; this
// forwards to padelnachos.com/api/admin/backfill-title-translations with
// the shared CRON_SECRET (which we never want to expose to the browser).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  try {
    const r = await fetch('https://padelnachos.com/api/admin/backfill-title-translations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    })
    const body = await r.json().catch(() => ({}))
    return NextResponse.json(body, { status: r.status })
  } catch (e) {
    return NextResponse.json({ error: 'forward_failed', message: (e as Error).message }, { status: 502 })
  }
}
