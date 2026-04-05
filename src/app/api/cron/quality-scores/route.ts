// src/app/api/cron/quality-scores/route.ts
// Hourly cron: recomputes quality_score for articles from the last 7 days.
// Runs at :07 past every hour via Vercel cron.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { computeArticleQuality } from '@/lib/quality-scoring'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  // Fetch articles from last 7 days with status=active
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: articles, error: fetchError } = await supabase
    .from('articles')
    .select('id, title, source_weight, click_count, impression_count, quality_score, source_name, published_at')
    .eq('status', 'active')
    .gte('published_at', sevenDaysAgo)

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!articles || articles.length === 0) {
    return NextResponse.json({ ok: true, articles_scored: 0, global_avg_ctr: 0 })
  }

  // Compute globalAvgCTR from total clicks/impressions across fetched articles
  const totalClicks = articles.reduce((sum, a) => sum + (a.click_count ?? 0), 0)
  const totalImpressions = articles.reduce((sum, a) => sum + (a.impression_count ?? 0), 0)
  const globalAvgCTR = totalImpressions > 0 ? totalClicks / totalImpressions : 0

  // Count articles per source in last 6 hours (flood detection)
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const sourceDailyCounts: Record<string, number> = {}
  for (const a of articles) {
    if (a.published_at && a.published_at >= sixHoursAgo) {
      const key = a.source_name ?? 'unknown'
      sourceDailyCounts[key] = (sourceDailyCounts[key] ?? 0) + 1
    }
  }

  // Compute and batch-update changed scores
  const updates: Array<{ id: string; quality_score: number }> = []

  for (const article of articles) {
    const sourceDailyCount = sourceDailyCounts[article.source_name ?? 'unknown'] ?? 0
    const newScore = computeArticleQuality(
      {
        title: article.title ?? '',
        source_weight: article.source_weight ?? 1.0,
        click_count: article.click_count ?? 0,
        impression_count: article.impression_count ?? 0,
        quality_score: article.quality_score,
      },
      globalAvgCTR,
      sourceDailyCount,
    )

    const oldScore = article.quality_score ?? 0
    if (Math.abs(newScore - oldScore) > 0.01) {
      updates.push({ id: article.id, quality_score: newScore })
    }
  }

  // Apply updates in batches of 100
  let updatedCount = 0
  const BATCH_SIZE = 100
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE)
    for (const update of batch) {
      const { error } = await supabase
        .from('articles')
        .update({ quality_score: update.quality_score })
        .eq('id', update.id)
      if (!error) updatedCount++
    }
  }

  return NextResponse.json({
    ok: true,
    articles_scored: updatedCount,
    global_avg_ctr: Math.round(globalAvgCTR * 10000) / 10000,
  })
}
