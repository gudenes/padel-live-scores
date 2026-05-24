// src/app/api/cron/refresh-source-volume/route.ts
// Daily 4am UTC. Recomputes news_sources.articles_last_7d from the articles
// table via the refresh_news_sources_volume_7d RPC (see migration
// 20260525_news_pipeline_volume_rpc.sql).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const meta = await logOpsEvent('cron:refresh-source-volume', async () => {
    const supabase = createServerClient()
    const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString()
    const { error } = await supabase.rpc('refresh_news_sources_volume_7d', { cutoff_ts: cutoff })
    if (error) throw new Error(`rpc: ${error.message}`)

    const { data: qUpdated, error: qErr } = await supabase.rpc('refresh_source_quality_pct')
    if (qErr) {
      console.error('quality refresh failed:', qErr)
      // non-fatal — continue
    }

    // Step 3: auto-disable dead sources (with circuit breaker)
    const { data: disableResult, error: dErr } = await supabase.rpc('auto_disable_dead_sources')
    if (dErr) {
      console.error('auto-disable failed:', dErr)
    }

    return {
      cutoff,
      ok: true,
      quality_updated: qUpdated ?? null,
      auto_disable: disableResult?.[0] ?? null,
    }
  })

  return NextResponse.json(meta)
}
