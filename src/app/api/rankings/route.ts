import { createServiceClient, createAnonServerClient } from '@/lib/supabase'
import { loadOfficialLeaderboard } from '@/lib/official-leaderboard'

export async function GET(request: Request) {
  const gender = new URL(request.url).searchParams.get('gender') ?? 'men'
  if (gender !== 'men' && gender !== 'women') {
    return Response.json({ error: 'Invalid gender' }, { status: 400 })
  }
  try {
    const result = await loadOfficialLeaderboard(createServiceClient(), createAnonServerClient(), gender)
    return Response.json(result, { headers: { 'Cache-Control': 'public, max-age=60' } })
  } catch (error) {
    console.error('[rankings] official snapshot load failed', error)
    return Response.json({ error: 'Unable to load rankings' }, { status: 503 })
  }
}
