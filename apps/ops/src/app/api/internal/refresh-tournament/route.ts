// apps/ops/src/app/api/internal/refresh-tournament/route.ts
// Forwards POST { tournamentId } to padelgod's POST /admin/refresh-tournament.
// Auth: Auth.js session with isOperator check.

import { auth } from '@/lib/auth'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const refreshUrl = process.env.PADELGOD_REFRESH_URL
  const adminToken = process.env.PADELGOD_ADMIN_TOKEN
  if (!refreshUrl) {
    return Response.json(
      { error: 'PADELGOD_REFRESH_URL is not set' },
      { status: 500 },
    )
  }
  if (!adminToken) {
    return Response.json(
      { error: 'PADELGOD_ADMIN_TOKEN is not set' },
      { status: 500 },
    )
  }

  let body: { tournamentId?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const tournamentId = body.tournamentId?.trim()
  if (!tournamentId) {
    return Response.json(
      { error: 'tournamentId required' },
      { status: 400 },
    )
  }

  let upstream: Response
  try {
    upstream = await fetch(refreshUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ tournamentId }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json(
      { error: `padelgod unreachable: ${message}` },
      { status: 502 },
    )
  }

  const text = await upstream.text()
  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  })
}
