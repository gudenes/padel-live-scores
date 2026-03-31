// src/app/api/cron/sync-highlights/route.ts
// Fetches latest videos from YouTube channels and upserts into highlights table.
// Runs every 6 hours via Vercel cron.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const maxDuration = 60

// Broad search queries — finds highlights from broadcasters and other sources
const SEARCH_QUERIES = [
  'premier padel highlights',
  'premier padel best points',
  'premier padel match highlights 2026',
]

// Priority YouTube handles — always fetch their latest videos
const PRIORITY_CHANNELS = [
  'PremierPadelOfficial',
]

interface YouTubeSearchItem {
  id: { videoId: string }
  snippet: {
    title: string
    channelTitle: string
    publishedAt: string
    thumbnails: { medium: { url: string }; high: { url: string } }
  }
}

interface YouTubeVideoItem {
  id: string
  contentDetails: {
    duration: string
    regionRestriction?: {
      allowed?: string[]
      blocked?: string[]
    }
  }
  statistics: { viewCount: string }
}

// Convert ISO 8601 duration (PT8M24S) to "8:24"
function formatDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return ''
  const h = parseInt(match[1] || '0')
  const m = parseInt(match[2] || '0')
  const s = parseInt(match[3] || '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// Get total seconds from ISO 8601 duration
function durationSeconds(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  return parseInt(match[1] || '0') * 3600 + parseInt(match[2] || '0') * 60 + parseInt(match[3] || '0')
}

const MIN_DURATION_SECONDS = 300 // 5 minutes

// Infer category from video title
function inferCategory(title: string): string | null {
  const lower = title.toLowerCase()
  if (lower.includes("women") || lower.includes("female") || lower.includes("femenino")) return 'women'
  if (lower.includes("men's") || lower.includes("masculino")) return 'men'
  return null
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'YOUTUBE_API_KEY not configured' }, { status: 500 })
  }

  const supabase = createServerClient()
  const allVideoIds: Set<string> = new Set()
  const priorityVideoIds: Set<string> = new Set()
  const videoMap: Record<string, { title: string; channelName: string; thumbnailUrl: string; publishedAt: string }> = {}

  // Step 0: Resolve priority channel handles → channel IDs, then fetch their recent videos
  for (const handle of PRIORITY_CHANNELS) {
    try {
      // Resolve handle to channel ID
      const chParams = new URLSearchParams({ part: 'id', forHandle: handle, key: apiKey })
      const chRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?${chParams}`)
      if (!chRes.ok) { console.error(`Channel lookup failed for @${handle}:`, await chRes.text()); continue }
      const chData = await chRes.json()
      const channelId = chData.items?.[0]?.id
      if (!channelId) { console.error(`No channel found for @${handle}`); continue }

      // Search this channel's recent videos
      const params = new URLSearchParams({
        part: 'snippet',
        channelId,
        type: 'video',
        order: 'date',
        maxResults: '15',
        publishedAfter: new Date(Date.now() - 30 * 86400000).toISOString(),
        key: apiKey,
      })
      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`)
      if (!res.ok) { console.error(`Channel search failed for @${handle}:`, await res.text()); continue }
      const data = await res.json()
      for (const item of (data.items ?? []) as YouTubeSearchItem[]) {
        const vid = item.id.videoId
        allVideoIds.add(vid)
        priorityVideoIds.add(vid)
        videoMap[vid] = {
          title: item.snippet.title,
          channelName: item.snippet.channelTitle,
          thumbnailUrl: item.snippet.thumbnails.high?.url ?? item.snippet.thumbnails.medium?.url,
          publishedAt: item.snippet.publishedAt,
        }
      }
    } catch (err) {
      console.error(`Priority channel fetch failed for @${handle}:`, err)
    }
  }

  // Step 1: Search for videos across queries (broad search, no channel filter)
  for (const query of SEARCH_QUERIES) {
    try {
      const params = new URLSearchParams({
        part: 'snippet',
        q: query,
        type: 'video',
        order: 'date',
        maxResults: '10',
        publishedAfter: new Date(Date.now() - 30 * 86400000).toISOString(), // last 30 days
        key: apiKey,
      })

      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`)
      if (!res.ok) {
        console.error(`YouTube search error for "${query}":`, await res.text())
        continue
      }

      const data = await res.json()
      const items = (data.items ?? []) as YouTubeSearchItem[]

      for (const item of items) {
        const vid = item.id.videoId
        allVideoIds.add(vid)
        videoMap[vid] = {
          title: item.snippet.title,
          channelName: item.snippet.channelTitle,
          thumbnailUrl: item.snippet.thumbnails.high?.url ?? item.snippet.thumbnails.medium?.url,
          publishedAt: item.snippet.publishedAt,
        }
      }
    } catch (err) {
      console.error(`YouTube search failed for "${query}":`, err)
    }
  }

  if (allVideoIds.size === 0) {
    return NextResponse.json({ message: 'No videos found', inserted: 0 })
  }

  // Step 2: Get video details (duration, view count) in batches of 50
  const videoIds = [...allVideoIds]
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50)
    try {
      const params = new URLSearchParams({
        part: 'contentDetails,statistics',
        id: batch.join(','),
        key: apiKey,
      })

      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`)
      if (!res.ok) continue

      const data = await res.json()
      const items = (data.items ?? []) as YouTubeVideoItem[]

      for (const item of items) {
        const existing = videoMap[item.id]
        if (existing) {
          (existing as any).duration = formatDuration(item.contentDetails.duration)
          ;(existing as any).durationSecs = durationSeconds(item.contentDetails.duration)
          ;(existing as any).viewCount = parseInt(item.statistics.viewCount || '0')
          const rr = item.contentDetails.regionRestriction
          if (rr?.allowed) (existing as any).allowedCountries = rr.allowed
          if (rr?.blocked) (existing as any).blockedCountries = rr.blocked
        }
      }
    } catch (err) {
      console.error('YouTube videos.list failed:', err)
    }
  }

  // Step 2b: Detect private/unavailable videos — videos.list silently drops
  // videos it can't return (private, deleted, etc.).  Any ID in our map that
  // didn't come back from videos.list has no duration metadata, which means
  // it's unavailable.  Remove it from the map so we don't upsert a broken entry.
  const detailsReturned = new Set(
    Object.entries(videoMap)
      .filter(([, info]) => (info as any).duration !== undefined)
      .map(([id]) => id)
  )
  for (const id of allVideoIds) {
    if (!detailsReturned.has(id)) {
      delete videoMap[id]
    }
  }

  // Step 3: Filter out short videos (< 5 min) and upsert
  let upserted = 0
  let hidden = 0
  const errors: string[] = []

  // Priority channel videos skip the duration filter
  const filtered = Object.entries(videoMap).filter(
    ([id, info]) => priorityVideoIds.has(id) || ((info as any).durationSecs ?? 0) >= MIN_DURATION_SECONDS
  )

  const rows = filtered.map(([youtubeId, info]) => ({
    youtube_id: youtubeId,
    title: info.title,
    channel_name: info.channelName,
    thumbnail_url: info.thumbnailUrl,
    duration: (info as any).duration ?? null,
    view_count: (info as any).viewCount ?? 0,
    published_at: info.publishedAt,
    category: inferCategory(info.title),
    allowed_countries: (info as any).allowedCountries ?? null,
    blocked_countries: (info as any).blockedCountries ?? null,
    updated_at: new Date().toISOString(),
  }))

  // Batch upsert all at once
  const { error, data: upsertData } = await supabase
    .from('highlights')
    .upsert(rows, { onConflict: 'youtube_id' })
    .select('id')

  if (error) {
    errors.push(error.message)
  } else {
    upserted = upsertData?.length ?? 0
  }

  // Step 4: Health check — verify existing active videos are still available on YouTube.
  // YouTube videos.list silently omits private/deleted videos, so any ID missing
  // from the response is unavailable and should be hidden.
  try {
    const { data: activeVideos } = await supabase
      .from('highlights')
      .select('id, youtube_id')
      .eq('status', 'active')
      .order('published_at', { ascending: false })
      .limit(100)

    if (activeVideos && activeVideos.length > 0) {
      const ytIds = activeVideos.map((v: any) => v.youtube_id)
      const returnedIds = new Set<string>()

      // Check in batches of 50
      for (let i = 0; i < ytIds.length; i += 50) {
        const batch = ytIds.slice(i, i + 50)
        try {
          const params = new URLSearchParams({
            part: 'id,status',
            id: batch.join(','),
            key: apiKey,
          })
          const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`)
          if (!res.ok) continue
          const data = await res.json()
          for (const item of (data.items ?? [])) {
            // Only count as available if the video has a public or unlisted privacy status
            const privacyStatus = item.status?.privacyStatus
            if (privacyStatus === 'public' || privacyStatus === 'unlisted') {
              returnedIds.add(item.id)
            }
          }
        } catch { /* skip batch on error */ }
      }

      // Hide videos that YouTube didn't return or aren't public/unlisted
      const toHide = activeVideos.filter((v: any) => !returnedIds.has(v.youtube_id))
      if (toHide.length > 0) {
        const { error: hideErr } = await supabase
          .from('highlights')
          .update({ status: 'hidden', updated_at: new Date().toISOString() })
          .in('id', toHide.map((v: any) => v.id))
        if (hideErr) errors.push(`Hide error: ${hideErr.message}`)
        else hidden = toHide.length
        console.log(`Hid ${toHide.length} unavailable videos:`, toHide.map((v: any) => v.youtube_id))
      }
    }
  } catch (err) {
    console.error('Health check failed:', err)
  }

  return NextResponse.json({
    message: errors.length > 0 ? 'Highlights sync had errors' : 'Highlights sync complete',
    found: allVideoIds.size,
    filteredOut: allVideoIds.size - filtered.length,
    upserted,
    hidden,
    errors,
  })
}
