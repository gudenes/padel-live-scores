// src/app/api/ops/simulator/score/route.ts
// Proxies scoring commands to the relay's /simulate endpoint.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { checkOpsAuth } from '@/lib/ops-auth'

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
    console.log('[simulator/score] body keys:', Object.keys(body as Record<string, unknown>))
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
    if (!relayResponse.ok) {
      console.error('[simulator/score] relay returned', relayResponse.status, data)
    }
    return Response.json(data, { status: relayResponse.status })
  } catch (err) {
    console.error('[simulator/score] relay request failed', err)
    return Response.json({ error: 'Failed to reach relay' }, { status: 502 })
  }
}
