// src/app/api/cron/sync-fip-rankings/route.ts
// Cron wrapper for FIP ranking sync — runs daily at 5 AM UTC.
// FIP updates rankings weekly; daily runs ensure we catch it promptly.
// Delegates to the admin sync endpoint logic.

import { NextRequest } from 'next/server'
import { GET as syncFipRankings } from '@/app/api/admin/sync-fip-rankings/route'
import { logOpsEvent } from '@/lib/ops-logger'

export const maxDuration = 120 // FIP fetch for 4 queries (2 genders × 2 types) can take a while

export async function GET(req: NextRequest) {
  // Verify cron secret in production
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Build a request that syncs both official + race, top 1000
  const url = new URL(req.url)
  url.searchParams.set('top', '1000')
  const fakeReq = new NextRequest(url)

  try {
    const meta = await logOpsEvent('cron:rankings', async () => {
      const res = await syncFipRankings(fakeReq)
      const data = await res.json()
      return { official: data.official ?? 0, race: data.race ?? 0 }
    })
    return Response.json(meta)
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
