// apps/ops/src/app/api/internal/notification-catalog/route.ts
// Server-side proxy: the Notifications console reads the available
// notification scenarios/catalog from the main app. Forwards with the shared
// CRON_SECRET (never exposed to the browser). Mirrors the broadcast proxy.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const target = process.env.MAIN_APP_URL ?? 'https://padelnachos.com'
  try {
    const r = await fetch(`${target}/api/internal/notification-catalog`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    const json = await r.json().catch(() => ({}))
    return NextResponse.json(json, { status: r.status })
  } catch (e) {
    return NextResponse.json({ error: 'forward_failed', message: (e as Error).message }, { status: 502 })
  }
}
