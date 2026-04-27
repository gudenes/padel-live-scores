// src/app/api/cron/sync-fip-rankings/route.ts
// Cron wrapper for FIP ranking sync.
//
// Originally one daily invocation handled 2 genders × 2 types × top 1000 in
// serial — per-player resolver round trips (~3 each × ~4000 players) blew
// past Vercel's 120s maxDuration, the function got killed mid-flight, and
// logOpsEvent's catch never fired (which is why ops_events had ZERO
// `cron:rankings` rows for weeks despite the schedule being live).
//
// Fix: split into 4 invocations using ?type= + ?gender= query params, each
// handling ~1000 players. Vercel cron entries pass the params through
// (see vercel.json). Each split run finishes in ~30-45s, well under budget.
//
// Endpoint accepts ?type=official|race and ?gender=male|female. Without
// either, falls back to the unsplit "do everything" path — useful for
// manual one-shot resync via /api/admin/sync-fip-rankings (which has no
// time limit).

import { NextRequest } from 'next/server'
import { GET as syncFipRankings } from '@/app/api/admin/sync-fip-rankings/route'
import { logOpsEvent } from '@/lib/ops-logger'

export const maxDuration = 120

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Pass through type + gender to the admin endpoint, defaulting to top 1000.
  const url = new URL(req.url)
  url.searchParams.set('top', '1000')
  const type = url.searchParams.get('type') ?? 'all'
  const gender = url.searchParams.get('gender') ?? 'all'
  // Distinct ops_events source per (type, gender) so the dashboard shows
  // each cron slot as a separate row — easier to spot if one of the four
  // is silently failing while the others succeed.
  const eventSource = `cron:rankings:${type}:${gender}`
  const fakeReq = new NextRequest(url)

  try {
    const meta = await logOpsEvent(eventSource, async () => {
      const res = await syncFipRankings(fakeReq)
      const data = await res.json()
      return {
        type, gender,
        official: data.official ?? 0,
        race: data.race ?? 0,
      }
    })
    return Response.json(meta)
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
