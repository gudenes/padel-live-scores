// src/app/api/ops/simulator/score/route.ts
// Proxies scoring commands to the relay's /simulate endpoint.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { cookies } from 'next/headers'

async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  if (!process.env.CRON_SECRET) {
    console.error('[Ops Auth] CRON_SECRET env var is not set')
    return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  }
  if (token !== process.env.CRON_SECRET) {
    console.error('[Ops Auth] Token mismatch', { hasToken: !!token, tokenLength: token?.length })
    return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  }
  return null
}

export async function POST(request: Request) {
  const authError = await checkOpsAuth()
  if (authError) return authError

  const relayUrl = process.env.RELAY_URL
  const relaySecret = process.env.RELAY_SECRET

  if (!relayUrl) {
    return Response.json({ error: 'RELAY_URL not configured' }, { status: 500 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const relayResponse = await fetch(`${relayUrl}/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(relaySecret ? { Authorization: `Bearer ${relaySecret}` } : {}),
      },
      body: JSON.stringify(body),
    })

    const data = await relayResponse.json()
    return Response.json(data, { status: relayResponse.status })
  } catch (err) {
    console.error('[simulator/score] relay request failed', err)
    return Response.json({ error: 'Failed to reach relay' }, { status: 502 })
  }
}
