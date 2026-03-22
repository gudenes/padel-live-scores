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

    if (!res.ok) {
      return Response.json({ error: 'Stats not available' }, { status: 404 })
    }

    const data = await res.json()
    return Response.json(data)
  } catch (error) {
    return Response.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
