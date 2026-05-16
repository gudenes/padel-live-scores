// src/app/api/cron/youtube-channels-discover/route.ts
//
// Polls the YouTube uploads playlist of every active row in
// `youtube_channels` every 5 min. UPSERTs currently-live videos into
// `youtube_channel_live`; prunes stale rows (last seen >30 min ago).
//
// Spec: docs/superpowers/specs/2026-05-14-youtube-live-indicator-design.md
// Schedule: */5 * * * * (every 5 minutes), see vercel.json
//
// Cost: 2 quota units per channel per run. At 2 channels = ~1.2k/day.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'
import {
  listUploadsPlaylistItems,
  listVideoDetails,
  YouTubeQuotaError,
} from '@/lib/youtube-channel-api'

export const maxDuration = 60

const STALE_MS = 30 * 60 * 1000

interface ChannelRow {
  id: string
  channel_id: string
  uploads_playlist_id: string
  name: string
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: true, skipped: 'no_api_key' })
  }

  try {
    const meta = await logOpsEvent('cron:youtube-channels-discover', async () => {
      const supabase = createServerClient()

      const { data: channels, error: chErr } = await supabase
        .from('youtube_channels')
        .select('id, channel_id, uploads_playlist_id, name')
        .eq('is_active', true)
        .order('display_order', { ascending: true })
      if (chErr) throw chErr

      const result = {
        channels_polled: 0,
        live_videos_seen: 0,
        upserts: 0,
        deletes: 0,
        per_channel: [] as Array<{ name: string; live: number; error?: string }>,
      }

      // One timestamp for the whole run — keeps last_seen_at consistent
      // across all upserts in this invocation.
      const now = new Date().toISOString()

      for (const ch of (channels ?? []) as ChannelRow[]) {
        result.channels_polled++
        try {
          // Scan the last 50 uploads (max page size). A busy channel like
          // FIP interleaves recaps/highlights/finished broadcasts between
          // active livestreams, so a tighter limit can push currently-live
          // broadcasts past the cutoff and silently drop them. `playlistItems`
          // and `videos` both cost 1 quota unit regardless of page size.
          const items = await listUploadsPlaylistItems(ch.uploads_playlist_id, apiKey, 50)
          if (items.length === 0) {
            result.per_channel.push({ name: ch.name, live: 0 })
            continue
          }
          const ids = items.map(i => i.videoId)
          const videos = await listVideoDetails(ids, apiKey)
          const live = videos.filter(v => v.liveBroadcastContent === 'live')
          result.per_channel.push({ name: ch.name, live: live.length })
          result.live_videos_seen += live.length

          for (const v of live) {
            const { error: upErr } = await supabase
              .from('youtube_channel_live')
              .upsert(
                {
                  channel_id: ch.id,
                  video_id: v.videoId,
                  title: v.title,
                  started_at: v.actualStartTime,
                  last_seen_at: now,
                },
                { onConflict: 'channel_id,video_id' },
              )
            if (upErr) throw upErr
            result.upserts++
          }
        } catch (chErr) {
          // Quota exhaustion is fatal — bubble up to the outer handler so
          // the whole run short-circuits with `skipped: 'quota_exhausted'`.
          if (chErr instanceof YouTubeQuotaError) throw chErr
          // Per-channel transient error: record it and continue.
          const message = chErr instanceof Error ? chErr.message : String(chErr)
          console.error(`[cron:youtube-channels-discover] channel '${ch.name}' failed:`, message)
          result.per_channel.push({ name: ch.name, live: 0, error: message })
        }
      }

      // Prune stale rows.
      const cutoff = new Date(Date.now() - STALE_MS).toISOString()
      const { count, error: delErr } = await supabase
        .from('youtube_channel_live')
        .delete({ count: 'exact' })
        .lt('last_seen_at', cutoff)
      if (delErr) throw delErr
      result.deletes = count ?? 0

      return result
    })

    return NextResponse.json({ ok: true, ...meta })
  } catch (err) {
    if (err instanceof YouTubeQuotaError) {
      return NextResponse.json({ ok: true, skipped: 'quota_exhausted' })
    }
    console.error('[cron:youtube-channels-discover] failed:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
