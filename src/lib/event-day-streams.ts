// src/lib/event-day-streams.ts
//
// Per-day YouTube stream cards for operator-curated managed events
// (src/lib/managed-events.ts). Some events — e.g. the Reserve Cup
// exhibition — publish one full-day YouTube broadcast per day. We keep the
// video IDs in a small per-slug config here (not operator-managed; a one-off
// for the handful of events that work this way) and compute a truthful
// LIVE / UPCOMING / REPLAY badge from YouTube's own broadcast state.
//
// Pure module — no I/O. The server-side YouTube fetch lives in
// event-day-streams-server.ts. This file is unit-tested.

export type DayStreamBadge = 'live' | 'upcoming' | 'replay'

/** One day's broadcast, as configured per event. */
export interface EventDayStream {
  day: number // 1-based
  date: string // 'YYYY-MM-DD' (the broadcast day, used for ordering + fallback)
  videoId: string
}

/** A day card ready for display. */
export interface DayStreamCard {
  day: number
  videoId: string
  dayDate: string // 'YYYY-MM-DD'
  url: string
  badge: DayStreamBadge
  /** ISO start time; only meaningful when badge === 'upcoming'. */
  scheduledStartTime: string | null
}

/** Minimal YouTube state we consume (subset of VideoDetails). */
export interface VideoLiveState {
  liveBroadcastContent: 'live' | 'upcoming' | 'none' | null
  scheduledStartTime: string | null
}

/**
 * Per-event day streams, keyed by managed_events.slug. Add an entry here when
 * an event broadcasts a full day per YouTube video. Empty/absent slug → the
 * event renders with no day-streams block.
 */
export const EVENT_DAY_STREAMS: Record<string, EventDayStream[]> = {
  'reserve-cup-marbella-2026': [
    { day: 1, date: '2026-06-18', videoId: 'BsofMZlgI2o' },
    { day: 2, date: '2026-06-19', videoId: '2laxETHywfU' },
    { day: 3, date: '2026-06-20', videoId: '0AU-20vxFxA' },
  ],
}

export function eventDayStreamConfig(slug: string): EventDayStream[] {
  return EVENT_DAY_STREAMS[slug] ?? []
}

function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
}

/**
 * Map YouTube broadcast state (or a date heuristic when the API is
 * unavailable) to a display badge. YouTube's live/upcoming states are
 * authoritative; `none` and `null` defer to the calendar date so a video that
 * was never set up as a premiere still reads as UPCOMING when its day is in
 * the future, and LIVE is never inferred from the date alone.
 */
export function computeDayStreamBadge(input: {
  liveBroadcastContent: 'live' | 'upcoming' | 'none' | null
  scheduledStartTime: string | null
  dayDate: string // 'YYYY-MM-DD'
  todayUtc: string // 'YYYY-MM-DD'
}): { badge: DayStreamBadge; scheduledStartTime: string | null } {
  if (input.liveBroadcastContent === 'live') {
    return { badge: 'live', scheduledStartTime: null }
  }
  if (input.liveBroadcastContent === 'upcoming') {
    return { badge: 'upcoming', scheduledStartTime: input.scheduledStartTime }
  }
  // none | null → date-based fallback
  if (input.dayDate > input.todayUtc) {
    return { badge: 'upcoming', scheduledStartTime: null }
  }
  return { badge: 'replay', scheduledStartTime: null }
}

/**
 * Pure: an event's day-stream config + YouTube state (by videoId) → sorted,
 * badged day cards. `liveByVideoId` is empty when YouTube is unavailable, in
 * which case every card falls back to the date heuristic.
 */
export function shapeEventDayStreams(
  config: EventDayStream[],
  liveByVideoId: Map<string, VideoLiveState>,
  todayUtc: string,
): DayStreamCard[] {
  return [...config]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => {
      const live = liveByVideoId.get(d.videoId)
      const { badge, scheduledStartTime } = computeDayStreamBadge({
        liveBroadcastContent: live?.liveBroadcastContent ?? null,
        scheduledStartTime: live?.scheduledStartTime ?? null,
        dayDate: d.date,
        todayUtc,
      })
      return {
        day: d.day,
        videoId: d.videoId,
        dayDate: d.date,
        url: watchUrl(d.videoId),
        badge,
        scheduledStartTime,
      }
    })
}
