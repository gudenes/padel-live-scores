// src/lib/fip-stream-resolver.ts
//
// Resolves a match to its YouTube stream affordance via the tier
// fallback chain defined in the spec.
//
// Tier 1: court stream with manual_offset_seconds (deep-link to match start)
// Tier 2: court stream without offset
// Tier 3: tournament has any stream known → scoped channel search URL
// Tier 4: no stream data → generic FIP channel URL

import type { SupabaseClient } from '@supabase/supabase-js'
import { isFipTier, FIP_CHANNEL_URL, FIP_CHANNEL_HANDLE } from './fip-channel'

export interface MatchForStream {
  id: string
  tournament_id: string
  tournament_level: string | null
  court: string | null
  scheduled_at: string | null
  played_at: string | null
}

export interface StreamTier {
  tier: 1 | 2 | 3 | 4
  url: string
  state: 'live' | 'upcoming' | 'archived' | 'channel'
  videoId: string | null
  title: string | null
  thumbnailUrl: string | null
  manualOffsetSeconds: number | null
}

interface CourtStreamRow {
  youtube_video_id: string
  title: string | null
  thumbnail_url: string | null
  state: 'upcoming' | 'live' | 'archived'
  manual_offset_seconds: number | null
}

function dayDateFromMatch(m: MatchForStream): string | null {
  const iso = m.scheduled_at ?? m.played_at
  if (!iso) return null
  return iso.slice(0, 10)
}

function tournamentSearchUrl(tournamentName: string): string {
  const q = encodeURIComponent(tournamentName)
  return `https://www.youtube.com/@${FIP_CHANNEL_HANDLE}/search?query=${q}`
}

export async function resolveStreamForMatch(
  supabase: SupabaseClient,
  match: MatchForStream,
  tournamentName?: string,
): Promise<StreamTier | null> {
  if (!isFipTier(match.tournament_level)) return null

  const dayDate = dayDateFromMatch(match)

  // Tier 1/2: court stream lookup (only if we have a court + day).
  if (match.court && dayDate) {
    const { data: courtRow } = await supabase
      .from('fip_court_streams')
      .select('youtube_video_id, title, thumbnail_url, state, manual_offset_seconds')
      .eq('tournament_id', match.tournament_id)
      .eq('court', match.court.toLowerCase())
      .eq('day_date', dayDate)
      .order('actual_start_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle() as { data: CourtStreamRow | null }

    if (courtRow) {
      const baseUrl = `https://www.youtube.com/watch?v=${courtRow.youtube_video_id}`
      const url = courtRow.manual_offset_seconds != null
        ? `${baseUrl}&t=${courtRow.manual_offset_seconds}s`
        : baseUrl
      return {
        tier: courtRow.manual_offset_seconds != null ? 1 : 2,
        url,
        state: courtRow.state,
        videoId: courtRow.youtube_video_id,
        title: courtRow.title,
        thumbnailUrl: courtRow.thumbnail_url,
        manualOffsetSeconds: courtRow.manual_offset_seconds,
      }
    }
  }

  // Tier 3: tournament has any stream known.
  const { data: anyRow } = await supabase
    .from('fip_court_streams')
    .select('youtube_video_id')
    .eq('tournament_id', match.tournament_id)
    .limit(1)
    .maybeSingle()

  if (anyRow && tournamentName) {
    return {
      tier: 3,
      url: tournamentSearchUrl(tournamentName),
      state: 'channel',
      videoId: null,
      title: null,
      thumbnailUrl: null,
      manualOffsetSeconds: null,
    }
  }

  // Tier 4: generic FIP channel.
  return {
    tier: 4,
    url: FIP_CHANNEL_URL,
    state: 'channel',
    videoId: null,
    title: null,
    thumbnailUrl: null,
    manualOffsetSeconds: null,
  }
}

export async function resolveStreamsForMatches(
  supabase: SupabaseClient,
  matches: MatchForStream[],
  tournamentNames: Record<string, string>,
): Promise<Map<string, StreamTier | null>> {
  // Naive batch: per-match query. Acceptable for v1 (10–60 matches per
  // page typical). Optimize with a single IN-clause query in v2 if it
  // shows up in profiling.
  const results = new Map<string, StreamTier | null>()
  for (const m of matches) {
    const tier = await resolveStreamForMatch(supabase, m, tournamentNames[m.tournament_id])
    results.set(m.id, tier)
  }
  return results
}
