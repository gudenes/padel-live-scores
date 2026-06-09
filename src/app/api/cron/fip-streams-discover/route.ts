// src/app/api/cron/fip-streams-discover/route.ts
//
// Discovers FIP YouTube livestreams + replays by scanning the FIP
// channel's uploads playlist every 15 min. Cheap: ~2 quota units/run.
//
// Spec: docs/superpowers/specs/2026-04-30-fip-youtube-streams-design.md
// Schedule: */15 * * * * (every 15 minutes), see vercel.json

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'
import { FIP_UPLOADS_PLAYLIST_ID, FIP_CHANNEL_ID } from '@/lib/fip-channel'
import { aggregateRegionBlocks } from '@/lib/where-to-watch/region-blocks'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  // Auth — same pattern as other crons.
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: true, skipped: 'no_api_key' })
  }

  try {
    const meta = await logOpsEvent('cron:fip-streams-discover', async () => {
      const supabase = createServerClient()
      const dryRun = process.env.FIP_STREAMS_DRY_RUN === 'true'

      // Tournament-aware short-circuit: only run if at least one FIP-tier
      // tournament is currently active or ended in the last 7 days.
      const { data: activeRow } = await supabase
        .from('tournaments')
        .select('id')
        .in('level', ['fip_bronze', 'fip_silver', 'fip_gold', 'fip_platinum', 'fip_promises', 'fip_other'])
        .lte('starts_at', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
        .gte('ends_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle()

      if (!activeRow) {
        return { ok: true, skipped: 'no_active_tournament' }
      }

      const { listUploadsPlaylistItems, fetchVideoDetailsBatch, YouTubeQuotaError } = await import('@/lib/youtube-channel-api')
      const { parseFipStreamTitle } = await import('@/lib/fip-stream-title-parser')

      const t0 = Date.now()
      const stats = {
        scanned: 0,
        newly_matched: 0,
        newly_unresolved: 0,
        open_unresolved_total: 0,
        state_transitions: { upcoming_to_live: 0, live_to_archived: 0 },
      }

      // 1. Enumerate the FIP channel's last 50 uploads.
      let playlistItems: Awaited<ReturnType<typeof listUploadsPlaylistItems>>
      try {
        playlistItems = await listUploadsPlaylistItems(FIP_UPLOADS_PLAYLIST_ID, apiKey, 50)
      } catch (e) {
        if (e instanceof YouTubeQuotaError) {
          return { ok: true, skipped: 'quota_exhausted', ms: Date.now() - t0 }
        }
        throw e
      }
      const allVideoIds = playlistItems.map(it => it.videoId)
      stats.scanned = allVideoIds.length

      if (allVideoIds.length === 0) {
        return { ok: true, ...stats, ms: Date.now() - t0 }
      }

      // 2. Find which video IDs we haven't seen yet (or whose state may have changed).
      const { data: seenStreams } = await supabase
        .from('fip_court_streams')
        .select('youtube_video_id, state')
        .in('youtube_video_id', allVideoIds)
      const { data: seenUnresolved } = await supabase
        .from('fip_streams_unresolved')
        .select('youtube_video_id')
        .in('youtube_video_id', allVideoIds)

      const seenStreamIds = new Map(
        (seenStreams ?? []).map(r => [r.youtube_video_id, r.state as string]),
      )
      const seenUnresolvedIds = new Set((seenUnresolved ?? []).map(r => r.youtube_video_id))

      // Refetch details for: new IDs + non-archived seen IDs (states may have changed).
      const toFetch = allVideoIds.filter(id => {
        const state = seenStreamIds.get(id)
        if (!state) return true
        return state !== 'archived'
      })

      if (toFetch.length === 0) {
        const { count: openCount } = await supabase
          .from('fip_streams_unresolved')
          .select('*', { count: 'exact', head: true })
          .is('resolved_at', null)
        stats.open_unresolved_total = openCount ?? 0
        return { ok: true, ...stats, ms: Date.now() - t0 }
      }

      // 3. Batch-fetch details (max 50 IDs/call — toFetch is always ≤50 here).
      let details: Awaited<ReturnType<typeof fetchVideoDetailsBatch>>
      try {
        details = await fetchVideoDetailsBatch(toFetch, apiKey)
      } catch (e) {
        if (e instanceof YouTubeQuotaError) {
          return { ok: true, skipped: 'quota_exhausted', ms: Date.now() - t0 }
        }
        throw e
      }

      // 4. Filter to actual livestreams (have liveStreamingDetails OR were live).
      const livestreamDetails = details.filter(
        d =>
          d.liveBroadcastContent === 'live' ||
          d.liveBroadcastContent === 'upcoming' ||
          d.actualStartTime !== null,
      )

      // 5. Load active FIP-tier tournaments for matching.
      const { data: activeTournaments } = await supabase
        .from('tournaments')
        .select('id, name, level, starts_at, ends_at')
        .in('level', ['fip_bronze', 'fip_silver', 'fip_gold', 'fip_platinum', 'fip_promises', 'fip_other'])
        .lte('starts_at', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
        .gte('ends_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

      type ActiveTournament = { id: string; name: string; level: string; starts_at: string; ends_at: string }
      const tournaments: ActiveTournament[] = (activeTournaments ?? []) as ActiveTournament[]

      // 6. For each livestream: parse title, match tournament, upsert.
      for (const d of livestreamDetails) {
        const parsed = parseFipStreamTitle(d.title)

        const newState =
          d.actualEndTime ? 'archived'
          : d.liveBroadcastContent === 'live' ? 'live'
          : d.liveBroadcastContent === 'upcoming' ? 'upcoming'
          : 'archived'

        const prevState = seenStreamIds.get(d.videoId)
        if (prevState === 'upcoming' && newState === 'live') stats.state_transitions.upcoming_to_live++
        if (prevState === 'live' && newState === 'archived') stats.state_transitions.live_to_archived++

        const wasSeenAnywhere = seenUnresolvedIds.has(d.videoId) || seenStreamIds.has(d.videoId)

        if (!parsed.tier || parsed.tournamentTokens.length === 0) {
          await upsertUnresolved(supabase, d, parsed, 'parser_failed', dryRun)
          if (!wasSeenAnywhere) stats.newly_unresolved++
          continue
        }

        const tourn = matchTournament(parsed, tournaments)
        if (!tourn) {
          await upsertUnresolved(supabase, d, parsed, 'no_tournament_match', dryRun)
          if (!wasSeenAnywhere) stats.newly_unresolved++
          continue
        }

        if (!parsed.court) {
          await upsertUnresolved(supabase, d, parsed, 'no_court', dryRun)
          if (!wasSeenAnywhere) stats.newly_unresolved++
          continue
        }

        const dayIso = d.actualStartTime ?? d.scheduledStartTime ?? null
        if (!dayIso) {
          await upsertUnresolved(supabase, d, parsed, 'parser_failed', dryRun)
          if (!wasSeenAnywhere) stats.newly_unresolved++
          continue
        }
        const dayDate = dayIso.slice(0, 10)

        const wasSeenAsStream = seenStreamIds.has(d.videoId)
        if (dryRun) {
          console.log('[fip-streams DRY_RUN] would upsert fip_court_streams:', { videoId: d.videoId, tournamentId: tourn.id, court: parsed.court, dayDate, state: newState })
          if (!wasSeenAsStream) stats.newly_matched++
        } else {
          const { error: upsertErr } = await supabase
            .from('fip_court_streams')
            .upsert({
              youtube_video_id: d.videoId,
              tournament_id: tourn.id,
              court: parsed.court,
              day_date: dayDate,
              title: d.title,
              thumbnail_url: d.thumbnailUrl,
              state: newState,
              scheduled_start_at: d.scheduledStartTime,
              actual_start_at: d.actualStartTime,
              actual_end_at: d.actualEndTime,
              view_count: d.viewCount,
              concurrent_viewers: d.concurrentViewers,
              link_method: 'auto',
              last_synced_at: new Date().toISOString(),
            }, { onConflict: 'youtube_video_id' })

          if (!upsertErr) {
            if (seenUnresolvedIds.has(d.videoId)) {
              await supabase
                .from('fip_streams_unresolved')
                .update({
                  resolved_at: new Date().toISOString(),
                  resolved_tournament_id: tourn.id,
                  resolved_court: parsed.court,
                  resolved_day_date: dayDate,
                })
                .eq('youtube_video_id', d.videoId)
            }
            if (!wasSeenAsStream) stats.newly_matched++
          }
        }
      }

      // 6b. Suggestion signal: learn this channel's geo-block footprint from the
      // regionRestriction on recent VODs (live videos often omit it).
      const observed = aggregateRegionBlocks(details)
      if (observed.sampleSize > 0) {
        const { data: chan } = await supabase
          .from('youtube_channels')
          .select('id')
          .eq('channel_id', FIP_CHANNEL_ID)
          .maybeSingle()
        if (chan?.id) {
          await supabase
            .from('youtube_channels')
            .update({ observed_region_blocks: observed, observed_at: new Date().toISOString() })
            .eq('id', chan.id)
        }
      }

      // 7. Final unresolved count.
      const { count: openCount } = await supabase
        .from('fip_streams_unresolved')
        .select('*', { count: 'exact', head: true })
        .is('resolved_at', null)
      stats.open_unresolved_total = openCount ?? 0

      return { ok: true, ...stats, ms: Date.now() - t0 }
    })
    return NextResponse.json(meta)
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

// ── Helpers ──────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParsedFipTitle } from '@/lib/fip-stream-title-parser'
import type { VideoDetails } from '@/lib/youtube-channel-api'

async function upsertUnresolved(
  supabase: SupabaseClient,
  d: VideoDetails,
  parsed: ParsedFipTitle,
  reason: 'parser_failed' | 'no_tournament_match' | 'no_court',
  dryRun: boolean,
) {
  if (dryRun) {
    console.log('[fip-streams DRY_RUN] would upsert fip_streams_unresolved:', { videoId: d.videoId, reason, parsedTokens: parsed.tournamentTokens })
    return
  }
  await supabase.from('fip_streams_unresolved').upsert(
    {
      youtube_video_id: d.videoId,
      channel_id: d.channelId,
      title: d.title,
      thumbnail_url: d.thumbnailUrl,
      state:
        d.liveBroadcastContent === 'live' ? 'live' :
        d.liveBroadcastContent === 'upcoming' ? 'upcoming' :
        d.actualEndTime ? 'archived' : null,
      scheduled_start_at: d.scheduledStartTime,
      reason,
      parsed_tournament_name: parsed.tournamentTokens.join(' '),
      parsed_day: parsed.day != null ? String(parsed.day) : null,
      parsed_court: parsed.court,
    },
    { onConflict: 'youtube_video_id' },
  )
}

function matchTournament(
  parsed: ParsedFipTitle,
  tournaments: Array<{ id: string; name: string; level: string }>,
): { id: string; name: string; level: string } | null {
  const tierLevelMap: Record<string, string> = {
    bronze: 'fip_bronze',
    silver: 'fip_silver',
    gold: 'fip_gold',
    platinum: 'fip_platinum',
    promises: 'fip_promises',
  }
  const expectedLevel = parsed.tier ? tierLevelMap[parsed.tier] : null

  const candidates = expectedLevel
    ? tournaments.filter(t => t.level === expectedLevel || t.level === 'fip_other')
    : tournaments

  const titleTokens = new Set(parsed.tournamentTokens)
  for (const t of candidates) {
    const tn = tournamentTokens(t.name)
    // Every parsed token must appear in tournament's token set.
    if ([...titleTokens].every(tok => tn.has(tok))) {
      return t
    }
  }
  return null
}

function tournamentTokens(name: string): Set<string> {
  return new Set(
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 0)
      .filter(t => !['premier', 'padel', 'tour', 'open', 'cup', 'fip'].includes(t))
      .filter(t => !/^\d{4}$/.test(t)),
  )
}
