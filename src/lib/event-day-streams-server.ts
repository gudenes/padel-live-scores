// src/lib/event-day-streams-server.ts
//
// Server-side resolver for an event's per-day YouTube stream cards. Reads the
// per-slug config, fetches fresh YouTube broadcast state for the configured
// video IDs (one batched call, 1 quota unit), and returns badged day cards.
// Degrades to a date-based badge when YOUTUBE_API_KEY is missing or the
// YouTube call fails. A small in-memory TTL cache keeps repeated page renders
// off the YouTube quota.

import { listVideoDetails } from '@/lib/youtube-channel-api'
import {
  eventDayStreamConfig,
  shapeEventDayStreams,
  type DayStreamCard,
  type VideoLiveState,
} from '@/lib/event-day-streams'

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number; cards: DayStreamCard[] }>()

/**
 * Resolve the day-stream cards for a managed event slug. Returns [] when the
 * event has no configured day streams. Never throws — YouTube failures fall
 * back to the date heuristic.
 */
export async function getEventDayStreams(slug: string): Promise<DayStreamCard[]> {
  const config = eventDayStreamConfig(slug)
  if (config.length === 0) return []

  const cached = cache.get(slug)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.cards
  }

  const liveByVideoId = new Map<string, VideoLiveState>()
  const apiKey = process.env.YOUTUBE_API_KEY
  if (apiKey) {
    try {
      const details = await listVideoDetails(config.map(d => d.videoId), apiKey)
      for (const d of details) {
        liveByVideoId.set(d.videoId, {
          liveBroadcastContent: d.liveBroadcastContent,
          scheduledStartTime: d.scheduledStartTime,
        })
      }
    } catch {
      // leave map empty → date-based fallback in shapeEventDayStreams
    }
  }

  const todayUtc = new Date().toISOString().slice(0, 10)
  const cards = shapeEventDayStreams(config, liveByVideoId, todayUtc)
  cache.set(slug, { at: Date.now(), cards })
  return cards
}
