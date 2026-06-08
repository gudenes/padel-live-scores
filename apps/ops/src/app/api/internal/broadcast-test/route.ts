// apps/ops/src/app/api/internal/broadcast-test/route.ts
// "Send test to me" — forwards the composed notification to the main app's
// test-push endpoint, targeting the logged-in operator's OWN email (so an
// operator can only ever test on their own devices). Mirrors the broadcast
// forward proxy; CRON_SECRET stays server-side.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const email = session.user.email
  if (!email) {
    return NextResponse.json({ error: 'no_email_on_session' }, { status: 400 })
  }
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const { title, body, url } = (await req.json().catch(() => ({}))) as {
    title?: string; body?: string; url?: string
  }
  const target = process.env.MAIN_APP_URL ?? 'https://padelnachos.com'
  try {
    const r = await fetch(`${target}/api/admin/test-push`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, title, body, url }),
    })
    const json = await r.json().catch(() => ({}))
    // Echo the targeted email so the UI can report where the test went.
    return NextResponse.json({ ...json, email }, { status: r.status })
  } catch (e) {
    return NextResponse.json({ error: 'forward_failed', message: (e as Error).message }, { status: 502 })
  }
}
