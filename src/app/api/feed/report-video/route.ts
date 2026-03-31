// src/app/api/feed/report-video/route.ts
// Client-side reports of unavailable YouTube videos.
// Hides the video so other users don't see it either.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const youtubeId = body?.youtube_id
  if (!youtubeId || typeof youtubeId !== 'string') {
    return NextResponse.json({ error: 'Missing youtube_id' }, { status: 400 })
  }

  const supabase = createServerClient()

  // Mark the video as hidden so it disappears from all users' feeds
  const { error } = await supabase
    .from('highlights')
    .update({ status: 'hidden', updated_at: new Date().toISOString() })
    .eq('youtube_id', youtubeId)
    .eq('status', 'active')

  if (error) {
    console.error('Failed to hide reported video:', error)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
