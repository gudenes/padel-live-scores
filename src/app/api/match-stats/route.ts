// src/app/api/match-stats/route.ts

const PADELAPI = 'https://padelapi.org/api'

function apiHeaders() {
  return {
    Authorization: `Bearer ${process.env.PADELAPI_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const externalId = searchParams.get('id')

  if (!externalId) {
    return Response.json({ error: 'Missing id' }, { status: 400 })
  }

  try {
    const res = await fetch(`${PADELAPI}/matches/${externalId}/stats`, {
      headers: apiHeaders(),
      next: { revalidate: 300 }, // cache 5 mins
    })

    // Check rate limit headers and warn in logs
    const remaining = res.headers.get('X-RateLimit-Remaining')
    const resetAt = res.headers.get('X-RateLimit-Reset')
    if (remaining !== null && parseInt(remaining) < 5) {
      console.warn(`[match-stats] Rate limit low — ${remaining} requests remaining, resets at ${resetAt}`)
    }

    // Handle rate limit explicitly — return 429 so the UI can handle it gracefully
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After') ?? '60'
      console.warn(`[match-stats] Rate limited — retry after ${retryAfter}s`)
      return Response.json(
        { error: 'Rate limited', retryAfter: parseInt(retryAfter) },
        { status: 429, headers: { 'Retry-After': retryAfter } }
      )
    }

    if (!res.ok) {
      return Response.json({ error: 'Stats not available' }, { status: 404 })
    }

    const data = await res.json()
    return Response.json(data)
  } catch (error) {
    console.error('[match-stats] Error:', error)
    return Response.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
