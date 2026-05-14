// src/app/api/ops/youtube-channels/[id]/test/route.ts
//
// One-shot discovery for a single channel — useful when adding a new
// channel during a live event to confirm wiring is correct without
// waiting up to 5 min for the cron.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import { listUploadsPlaylistItems, listVideoDetails, YouTubeQuotaError } from '@/lib/youtube-channel-api'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

interface Ctx {
  params: Promise<{ id: string }>
}

export async function POST(_request: NextRequest, { params }: Ctx) {
  const auth = await checkOpsAuth()
  if (auth) return auth

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'YOUTUBE_API_KEY not set' }, { status: 500 })

  const { id } = await params
  const { data: ch, error: chErr } = await supabase
    .from('youtube_channels')
    .select('id, channel_id, uploads_playlist_id, name')
    .eq('id', id)
    .single()
  if (chErr || !ch) return NextResponse.json({ error: 'channel not found' }, { status: 404 })

  try {
    const items = await listUploadsPlaylistItems(ch.uploads_playlist_id as string, apiKey, 5)
    if (items.length === 0) return NextResponse.json({ liveCount: 0, videos: [] })
    const videos = await listVideoDetails(items.map(i => i.videoId), apiKey)
    const live = videos.filter(v => v.liveBroadcastContent === 'live')
    return NextResponse.json({
      liveCount: live.length,
      videos: live.map(v => ({ videoId: v.videoId, title: v.title })),
    })
  } catch (err) {
    if (err instanceof YouTubeQuotaError) return NextResponse.json({ error: 'quota_exhausted' }, { status: 429 })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
