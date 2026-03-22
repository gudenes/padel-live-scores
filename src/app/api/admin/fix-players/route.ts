// src/app/api/admin/fix-players/route.ts
// One-time fix: fetches missing avatar_url, ranking, country for all players

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const PADELAPI = 'https://padelapi.org/api'

function apiHeaders() {
  return {
    Authorization: `Bearer ${process.env.PADELAPI_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function fetchWithRetry(url: string, retries = 3): Promise<{ data: any | null; remaining: number }> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, { headers: apiHeaders() })
    const remaining = parseInt(res.headers.get('X-RateLimit-Remaining') ?? '60')

    if (res.ok) return { data: await res.json(), remaining }
    if (res.status === 404) return { data: null, remaining }
    if (res.status === 429) {
      const wait = 60000 / 60 * (i + 2) // back off progressively
      console.log(`[Fix Players] Rate limited — waiting ${wait}ms...`)
      await sleep(wait)
      continue
    }
    return { data: null, remaining }
  }
  return { data: null, remaining: 60 }
}

export async function GET() {
  // Fetch all players with missing data — including side
  const { data: players, error } = await supabase
    .from('players')
    .select('id, name, external_id, avatar_url, ranking, country, side')
    .or('avatar_url.is.null,ranking.is.null,country.is.null,side.is.null')
    .order('name')

  if (error || !players) {
    return Response.json({ error: 'Failed to fetch players', detail: error }, { status: 500 })
  }

  console.log(`[Fix Players] Found ${players.length} players with missing data`)

  let updated = 0
  let failed = 0
  let skipped = 0

  for (const player of players) {
    if (!player.external_id) { skipped++; continue }

    try {
      const { data: detail, remaining: r1 } = await fetchWithRetry(`${PADELAPI}/players/${player.external_id}`)

      if (!detail) {
        console.log(`[Fix Players] Skipping ${player.name} — not found`)
        skipped++
        await sleep(1000)
        continue
      }

      // Dynamic delay: if remaining is low, slow down
      const delay = r1 < 10 ? 2000 : r1 < 20 ? 1500 : 1000
      await sleep(delay)

      const { data: stats, remaining: r2 } = await fetchWithRetry(`${PADELAPI}/players/${player.external_id}/stats`)
      await sleep(r2 < 10 ? 2000 : r2 < 20 ? 1500 : 1000)

      const winRate = stats?.win_percentage
        ? Math.round(parseFloat(stats.win_percentage))
        : null

      const { error: updateError } = await supabase
        .from('players')
        .update({
          avatar_url: detail.photo_url ?? player.avatar_url,
          ranking: detail.ranking ? parseInt(detail.ranking) : player.ranking,
          country: detail.nationality ?? player.country,
          side: detail.side ?? null,
          ...(winRate !== null && { win_rate: winRate }),
          ...(stats?.matches_played && { total_matches: stats.matches_played }),
        })
        .eq('id', player.id)

      if (updateError) {
        console.error(`[Fix Players] Failed to update ${player.name}:`, updateError)
        failed++
      } else {
        console.log(`[Fix Players] ✓ ${player.name} — photo: ${detail.photo_url ? 'yes' : 'no'}, ranking: ${detail.ranking}, remaining: ${r2}`)
        updated++
      }

    } catch (err) {
      console.error(`[Fix Players] Error for ${player.name}:`, err)
      failed++
      await sleep(1000)
    }
  }

  return Response.json({
    total: players.length,
    updated,
    failed,
    skipped,
  })
}
