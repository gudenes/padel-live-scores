// src/app/api/admin/enrich-articles-backfill/route.ts
// One-shot batched backfill. Counts pending articles in a window,
// then nudges the enrich-articles cron in a loop (sleep 60s) until
// no more progress is made.
//
// Usage:
//   POST /api/admin/enrich-articles-backfill                    → process last 7 days
//   POST /api/admin/enrich-articles-backfill?days=30            → last 30 days
//   POST /api/admin/enrich-articles-backfill?dry=true           → dry-run (count only)
//
// Auth: Authorization: Bearer $CRON_SECRET

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'

export const maxDuration = 800
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') ?? '7', 10), 1), 30)
  const dryRun = url.searchParams.get('dry') === 'true'

  const meta = await logOpsEvent('admin:enrich-articles-backfill', async () => {
    const supabase = createServerClient()
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString()

    const { count, error: countErr } = await supabase
      .from('articles')
      .select('id', { count: 'exact', head: true })
      .eq('enrichment_status', 'pending')
      .gte('published_at', cutoff)

    if (countErr) throw new Error(`count: ${countErr.message}`)

    if (dryRun) {
      return { dry: true, would_process: count, days, cutoff }
    }

    // Nudge the cron in a loop. Each call processes up to 20 articles.
    // Stop when the cron reports 0 processed (no more pending in the queue).
    let totalEnriched = 0
    let totalFailed = 0
    const maxIterations = Math.ceil((count ?? 0) / 20) + 1

    for (let i = 0; i < maxIterations; i++) {
      const res = await fetch(`${url.origin}/api/cron/enrich-articles`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      })
      const data = await res.json()
      totalEnriched += data.enriched ?? 0
      totalFailed += data.failed ?? 0
      const processed = data.processed ?? 0
      if (processed === 0) break
      await new Promise(r => setTimeout(r, 60000))
    }

    return { days, totalEnriched, totalFailed }
  })

  return NextResponse.json(meta)
}
