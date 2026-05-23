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
import { isFipTier, FIP_CHANNEL_HANDLE } from './fip-channel'

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

export function tournamentSearchUrl(tournamentName: string): string {
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

  // No stream evidence for this tournament — return null so the UI doesn't
  // render a misleading "Watch on YouTube" button that lands on the FIP
  // channel home page. The "always show something" Tier 4 fallback was
  // dropped after the buttons appeared on every FIP-tier match before any
  // streams had been discovered, suggesting a promise we couldn't keep.
  return null
}

export async function resolveStreamsForMatches(
  supabase: SupabaseClient,
  matches: MatchForStream[],
  tournamentNames: Record<string, string>,
): Promise<Map<string, StreamTier | null>> {
  const results = new Map<string, StreamTier | null>()

  // Filter to FIP-tier matches up front; the rest are guaranteed null.
  const fipMatches = matches.filter((m) => isFipTier(m.tournament_level))
  for (const m of matches) if (!isFipTier(m.tournament_level)) results.set(m.id, null)
  if (fipMatches.length === 0) return results

  // Single batched fetch: every fip_court_streams row for the tournaments
  // referenced by today's matches. Then resolve the cascade in memory.
  // One round-trip regardless of match count — replaces the per-match query
  // pattern that pegged TTFB at ~134ms × N before this rewrite.
  const tournamentIds = Array.from(new Set(fipMatches.map((m) => m.tournament_id).filter(Boolean)))
  if (tournamentIds.length === 0) {
    for (const m of fipMatches) results.set(m.id, null)
    return results
  }

  const { data: streamRows, error } = await supabase
    .from('fip_court_streams')
    .select('tournament_id, court, day_date, youtube_video_id, title, thumbnail_url, state, manual_offset_seconds, actual_start_at')
    .in('tournament_id', tournamentIds)
    .order('actual_start_at', { ascending: false, nullsFirst: false })

  if (error) {
    console.error('[resolveStreamsForMatches] fetch failed:', error.message)
    for (const m of fipMatches) results.set(m.id, null)
    return results
  }

  // Index rows by composite key for Tier 1/2 lookup, and track per-tournament
  // existence for Tier 3. The .order() above means the first row we see for
  // a given (tournament, court, day) is the most recent — keep that one.
  const byCourtDay = new Map<string, CourtStreamRow>()
  const tournamentsWithAnyStream = new Set<string>()
  for (const row of (streamRows ?? []) as Array<CourtStreamRow & { tournament_id: string; court: string; day_date: string }>) {
    tournamentsWithAnyStream.add(row.tournament_id)
    const key = `${row.tournament_id}|${row.court}|${row.day_date}`
    if (!byCourtDay.has(key)) byCourtDay.set(key, row)
  }

  for (const m of fipMatches) {
    const dayDate = dayDateFromMatch(m)
    let resolved: StreamTier | null = null

    if (m.court && dayDate) {
      const courtRow = byCourtDay.get(`${m.tournament_id}|${m.court.toLowerCase()}|${dayDate}`)
      if (courtRow) {
        const baseUrl = `https://www.youtube.com/watch?v=${courtRow.youtube_video_id}`
        const url = courtRow.manual_offset_seconds != null
          ? `${baseUrl}&t=${courtRow.manual_offset_seconds}s`
          : baseUrl
        resolved = {
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

    if (!resolved && tournamentsWithAnyStream.has(m.tournament_id)) {
      const name = tournamentNames[m.tournament_id]
      if (name) {
        resolved = {
          tier: 3,
          url: tournamentSearchUrl(name),
          state: 'channel',
          videoId: null,
          title: null,
          thumbnailUrl: null,
          manualOffsetSeconds: null,
        }
      }
    }

    results.set(m.id, resolved)
  }

  return results
}
