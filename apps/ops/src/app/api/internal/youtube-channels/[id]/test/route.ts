// apps/ops/src/app/api/internal/youtube-channels/[id]/test/route.ts
//
// One-shot discovery for a single channel — useful when adding a new
// channel during a live event to confirm wiring is correct without
// waiting up to 5 min for the cron.
//
// Auth: Auth.js session with isOperator flag.
// Ported from src/app/api/ops/youtube-channels/[id]/test/route.ts (Plan 3b-extra Task 3).

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { listUploadsPlaylistItems, listVideoDetails, YouTubeQuotaError } from '@/lib/youtube-channel-api'

interface Ctx {
  params: Promise<{ id: string }>
}

export async function POST(_request: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'YOUTUBE_API_KEY not set' }, { status: 500 })

  const { id } = await params
  const supabase = serviceClient()
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
