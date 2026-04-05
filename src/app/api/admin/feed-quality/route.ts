// src/app/api/admin/feed-quality/route.ts
// Feed quality dashboard API — returns aggregated stats for articles and highlights.
//
// GET /api/admin/feed-quality

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { createServerClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const adminEmail = await verifyAdminRequest(request)
  if (!adminEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  const now = new Date()
  const ago7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  // Fetch articles (last 7 days, active)
  const { data: articles, error: articlesError } = await supabase
    .from('articles')
    .select('id, title, source_name, quality_score, click_count, impression_count, published_at')
    .eq('status', 'active')
    .gte('published_at', ago7d)
    .order('published_at', { ascending: false })

  if (articlesError) {
    return NextResponse.json({ error: articlesError.message }, { status: 500 })
  }

  // Fetch highlights (last 7 days, active)
  const { data: highlights, error: highlightsError } = await supabase
    .from('highlights')
    .select('id, title, channel_name, channel_quality_score, view_count, impression_count, published_at')
    .eq('status', 'active')
    .gte('published_at', ago7d)
    .order('published_at', { ascending: false })

  if (highlightsError) {
    return NextResponse.json({ error: highlightsError.message }, { status: 500 })
  }

  const arts = articles ?? []
  const vids = highlights ?? []

  // ── Overview ─────────────────────────────────────────────────────────────

  const arts24h = arts.filter(a => a.published_at >= ago24h)
  const vids24h = vids.filter(v => v.published_at >= ago24h)

  const avgQualityArticles =
    arts.length > 0
      ? arts.reduce((sum, a) => sum + (a.quality_score ?? 0), 0) / arts.length
      : 0

  const avgQualityVideos =
    vids.length > 0
      ? vids.reduce((sum, v) => sum + (v.channel_quality_score ?? 0), 0) / vids.length
      : 0

  const impressions24h =
    [...arts24h, ...vids24h].reduce((sum, item) => sum + (item.impression_count ?? 0), 0)

  const clicks24h =
    arts24h.reduce((sum, item) => sum + (item.click_count ?? 0), 0) +
    vids24h.reduce((sum, item) => sum + (item.view_count ?? 0), 0)

  const ctr24h = impressions24h > 0 ? clicks24h / impressions24h : 0

  const overview = {
    articles_24h: arts24h.length,
    articles_7d: arts.length,
    videos_24h: vids24h.length,
    videos_7d: vids.length,
    avg_quality_articles: Math.round(avgQualityArticles * 1000) / 1000,
    avg_quality_videos: Math.round(avgQualityVideos * 1000) / 1000,
    impressions_24h: impressions24h,
    ctr_24h: Math.round(ctr24h * 10000) / 10000,
  }

  // ── Sources ───────────────────────────────────────────────────────────────

  const sourceMap = new Map<string, {
    source: string
    type: 'article' | 'video'
    items: number
    quality_sum: number
    clicks: number
    impressions: number
  }>()

  for (const a of arts) {
    const key = `article::${a.source_name}`
    const entry = sourceMap.get(key) ?? { source: a.source_name ?? 'Unknown', type: 'article' as const, items: 0, quality_sum: 0, clicks: 0, impressions: 0 }
    entry.items++
    entry.quality_sum += a.quality_score ?? 0
    entry.clicks += a.click_count ?? 0
    entry.impressions += a.impression_count ?? 0
    sourceMap.set(key, entry)
  }

  for (const v of vids) {
    const key = `video::${v.channel_name}`
    const entry = sourceMap.get(key) ?? { source: v.channel_name ?? 'Unknown', type: 'video' as const, items: 0, quality_sum: 0, clicks: 0, impressions: 0 }
    entry.items++
    entry.quality_sum += v.channel_quality_score ?? 0
    entry.clicks += v.view_count ?? 0
    entry.impressions += v.impression_count ?? 0
    sourceMap.set(key, entry)
  }

  const globalImpressions = [...sourceMap.values()].reduce((s, e) => s + e.impressions, 0)
  const globalClicks = [...sourceMap.values()].reduce((s, e) => s + e.clicks, 0)
  const globalCtr = globalImpressions > 0 ? globalClicks / globalImpressions : 0

  const sources = [...sourceMap.values()]
    .map(e => ({
      source: e.source,
      type: e.type,
      items: e.items,
      avg_quality: e.items > 0 ? Math.round((e.quality_sum / e.items) * 1000) / 1000 : 0,
      clicks: e.clicks,
      impressions: e.impressions,
      ctr: e.impressions > 0 ? Math.round((e.clicks / e.impressions) * 10000) / 10000 : 0,
      global_ctr: Math.round(globalCtr * 10000) / 10000,
    }))
    .sort((a, b) => b.items - a.items)

  // ── Low Quality ───────────────────────────────────────────────────────────

  const lowQuality = [
    ...arts
      .filter(a => (a.quality_score ?? 1) < 0.8)
      .map(a => ({
        id: a.id,
        title: a.title,
        source: a.source_name ?? 'Unknown',
        quality_score: a.quality_score ?? 0,
        type: 'article' as const,
      })),
    ...vids
      .filter(v => (v.channel_quality_score ?? 1) < 0.8)
      .map(v => ({
        id: v.id,
        title: v.title,
        source: v.channel_name ?? 'Unknown',
        quality_score: v.channel_quality_score ?? 0,
        type: 'video' as const,
      })),
  ].sort((a, b) => a.quality_score - b.quality_score)

  // ── Content Mix (last 7 days by day) ─────────────────────────────────────

  const dayMap = new Map<string, { date: string; articles: number; videos: number; quality_sum: number; quality_count: number }>()

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    dayMap.set(key, { date: key, articles: 0, videos: 0, quality_sum: 0, quality_count: 0 })
  }

  for (const a of arts) {
    const key = a.published_at?.slice(0, 10)
    if (key && dayMap.has(key)) {
      const entry = dayMap.get(key)!
      entry.articles++
      entry.quality_sum += a.quality_score ?? 0
      entry.quality_count++
    }
  }

  for (const v of vids) {
    const key = v.published_at?.slice(0, 10)
    if (key && dayMap.has(key)) {
      const entry = dayMap.get(key)!
      entry.videos++
      entry.quality_sum += v.channel_quality_score ?? 0
      entry.quality_count++
    }
  }

  const contentMix = [...dayMap.values()].map(d => ({
    date: d.date,
    articles: d.articles,
    videos: d.videos,
    avg_quality: d.quality_count > 0 ? Math.round((d.quality_sum / d.quality_count) * 1000) / 1000 : 0,
  }))

  // ── Top Performers (min 10 impressions, top 10 by CTR) ───────────────────

  const allItems = [
    ...arts.map(a => ({
      id: a.id,
      title: a.title ?? '',
      type: 'article' as const,
      source: a.source_name ?? 'Unknown',
      clicks: a.click_count ?? 0,
      impressions: a.impression_count ?? 0,
      quality: a.quality_score ?? 0,
    })),
    ...vids.map(v => ({
      id: v.id,
      title: v.title ?? '',
      type: 'video' as const,
      source: v.channel_name ?? 'Unknown',
      clicks: v.view_count ?? 0,
      impressions: v.impression_count ?? 0,
      quality: v.channel_quality_score ?? 0,
    })),
  ]

  const topPerformers = allItems
    .filter(item => item.impressions >= 10)
    .map(item => ({
      ...item,
      ctr: Math.round((item.clicks / item.impressions) * 10000) / 10000,
    }))
    .sort((a, b) => b.ctr - a.ctr)
    .slice(0, 10)

  return NextResponse.json({
    overview,
    sources,
    lowQuality,
    contentMix,
    topPerformers,
  })
}
