// apps/ops/src/app/api/internal/notify-trigger/route.ts
// Server-side proxy: the Notifications console triggers a real notify-event
// fan-out (Send to followers + dryRun reach) on the main app. Forwards with
// the shared CRON_SECRET (never exposed to the browser). Mirrors the broadcast
// forward proxy.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const body = await req.json().catch(() => ({}))
  const target = process.env.MAIN_APP_URL ?? 'https://padelnachos.com'
  try {
    const r = await fetch(`${target}/api/push/notify-event`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await r.json().catch(() => ({}))
    return NextResponse.json(json, { status: r.status })
  } catch (e) {
    return NextResponse.json({ error: 'forward_failed', message: (e as Error).message }, { status: 502 })
  }
}
