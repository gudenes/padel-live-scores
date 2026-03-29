// src/app/api/cron/sync-highlights/route.ts
// Fetches latest videos from YouTube channels and upserts into highlights table.
// Runs every 6 hours via Vercel cron.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const maxDuration = 60

// YouTube channels to pull from — add more channel IDs as needed
const CHANNELS = [
  { id: 'UCy5E3iDS8MMapnFUGqKF8jA', name: 'Premier Padel' },
]

// Keywords to search within each channel
const SEARCH_QUERIES = [
  'highlights',
  'best points',
  'match point',
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
  contentDetails: { duration: string }
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
  const videoMap: Record<string, { title: string; channelName: string; thumbnailUrl: string; publishedAt: string }> = {}

  // Step 1: Search for videos across channels and queries
  for (const channel of CHANNELS) {
    for (const query of SEARCH_QUERIES) {
      try {
        const params = new URLSearchParams({
          part: 'snippet',
          channelId: channel.id,
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
        console.error(`YouTube search failed for "${query}" on ${channel.name}:`, err)
      }
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
          ;(existing as any).viewCount = parseInt(item.statistics.viewCount || '0')
        }
      }
    } catch (err) {
      console.error('YouTube videos.list failed:', err)
    }
  }

  // Step 3: Upsert into highlights table
  let inserted = 0
  let updated = 0

  for (const [youtubeId, info] of Object.entries(videoMap)) {
    const row = {
      youtube_id: youtubeId,
      title: info.title,
      channel_name: info.channelName,
      thumbnail_url: info.thumbnailUrl,
      duration: (info as any).duration ?? null,
      view_count: (info as any).viewCount ?? 0,
      published_at: info.publishedAt,
      category: inferCategory(info.title),
      updated_at: new Date().toISOString(),
    }

    const { error, status } = await supabase
      .from('highlights')
      .upsert(row, { onConflict: 'youtube_id' })

    if (error) {
      console.error(`Failed to upsert ${youtubeId}:`, error.message)
    } else {
      if (status === 201) inserted++
      else updated++
    }
  }

  return NextResponse.json({
    message: 'Highlights sync complete',
    found: allVideoIds.size,
    inserted,
    updated,
  })
}
