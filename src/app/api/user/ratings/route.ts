import { getUserOrFail } from '../_auth'

export async function GET() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data } = await supabase
    .from('match_ratings')
    .select('match_id, rating, updated_at')
    .eq('user_id', user.id)

  return Response.json(data ?? [])
}

export async function POST(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { matchId, rating } = await req.json()
  if (!matchId || !rating) return Response.json({ error: 'Missing matchId or rating' }, { status: 400 })

  const ratingNum = Number(rating)
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return Response.json({ error: 'Rating must be 1-5' }, { status: 400 })
  }

  const { error: dbErr } = await supabase
    .from('match_ratings')
    .upsert(
      { match_id: matchId, user_id: user.id, rating: ratingNum, updated_at: new Date().toISOString() },
      { onConflict: 'match_id,user_id' }
    )

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

  const { data: agg } = await supabase
    .from('match_ratings')
    .select('rating')
    .eq('match_id', matchId)

  const ratings = (agg ?? []).map(r => r.rating)
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null

  return Response.json({ avg_rating: avg, rating_count: ratings.length })
}
