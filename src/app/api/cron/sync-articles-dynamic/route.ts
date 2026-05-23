// src/app/api/cron/sync-articles-dynamic/route.ts
// Wed 3am UTC. Fetches Google News RSS for all enabled cadence='weekly' sources.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { fetchAndUpsertSource } from '@/lib/fetch-source'
import { logOpsEvent } from '@/lib/ops-logger'

export const maxDuration = 800
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const meta = await logOpsEvent('cron:sync-articles-dynamic', async () => {
    const supabase = createServerClient()
    const { data: sources, error } = await supabase
      .from('news_sources')
      .select('key, name, url, source_type, language, weight, lookback_days')
      .eq('cadence', 'weekly')
      .eq('enabled', true)
      .order('key')
    if (error) throw new Error(`load sources: ${error.message}`)

    let totalAdded = 0
    let failed = 0
    for (const src of sources ?? []) {
      const result = await fetchAndUpsertSource(supabase, src as any)
      totalAdded += result.added
      if (result.error) failed++
      await supabase.from('news_sources').update({
        last_fetch_at: new Date().toISOString(),
        last_fetch_status: result.error ? 'error' : (result.added === 0 ? 'empty' : 'success'),
        last_fetch_error: result.error,
      }).eq('key', src.key)
    }
    return { totalAdded, failed, sourceCount: sources?.length ?? 0 }
  })

  return NextResponse.json(meta)
}
