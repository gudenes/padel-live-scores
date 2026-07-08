import { describe, it, expect } from 'vitest'
import {
  computeDayStreamBadge,
  shapeEventDayStreams,
  eventDayStreamConfig,
  type EventDayStream,
  type VideoLiveState,
} from '../event-day-streams'

const TODAY = '2026-06-19'

describe('computeDayStreamBadge', () => {
  it('live broadcast → live', () => {
    expect(computeDayStreamBadge({
      liveBroadcastContent: 'live', scheduledStartTime: null,
      dayDate: '2026-06-19', todayUtc: TODAY,
    })).toEqual({ badge: 'live', scheduledStartTime: null })
  })

  it('upcoming broadcast → upcoming with scheduled time', () => {
    expect(computeDayStreamBadge({
      liveBroadcastContent: 'upcoming', scheduledStartTime: '2026-06-20T14:00:00Z',
      dayDate: '2026-06-20', todayUtc: TODAY,
    })).toEqual({ badge: 'upcoming', scheduledStartTime: '2026-06-20T14:00:00Z' })
  })

  it('none + past day → replay', () => {
    expect(computeDayStreamBadge({
      liveBroadcastContent: 'none', scheduledStartTime: null,
      dayDate: '2026-06-18', todayUtc: TODAY,
    })).toEqual({ badge: 'replay', scheduledStartTime: null })
  })

  it('none + future day (un-premiered) → upcoming, no time', () => {
    expect(computeDayStreamBadge({
      liveBroadcastContent: 'none', scheduledStartTime: null,
      dayDate: '2026-06-20', todayUtc: TODAY,
    })).toEqual({ badge: 'upcoming', scheduledStartTime: null })
  })

  it('api failed (null) + today → replay (never a false live)', () => {
    expect(computeDayStreamBadge({
      liveBroadcastContent: null, scheduledStartTime: null,
      dayDate: '2026-06-19', todayUtc: TODAY,
    })).toEqual({ badge: 'replay', scheduledStartTime: null })
  })

  it('api failed (null) + future → upcoming, no time', () => {
    expect(computeDayStreamBadge({
      liveBroadcastContent: null, scheduledStartTime: null,
      dayDate: '2026-06-21', todayUtc: TODAY,
    })).toEqual({ badge: 'upcoming', scheduledStartTime: null })
  })
})

const CONFIG: EventDayStream[] = [
  { day: 2, date: '2026-06-19', videoId: 'day2id' },
  { day: 1, date: '2026-06-18', videoId: 'day1id' },
  { day: 3, date: '2026-06-20', videoId: 'day3id' },
]

describe('shapeEventDayStreams', () => {
  it('sorts by date and builds watch URLs', () => {
    const cards = shapeEventDayStreams(CONFIG, new Map(), TODAY)
    expect(cards.map(c => c.videoId)).toEqual(['day1id', 'day2id', 'day3id'])
    expect(cards.map(c => c.day)).toEqual([1, 2, 3])
    expect(cards[0].url).toBe('https://www.youtube.com/watch?v=day1id')
  })

  it('applies YouTube live state when present', () => {
    const live = new Map<string, VideoLiveState>([
      ['day2id', { liveBroadcastContent: 'live', scheduledStartTime: null }],
      ['day3id', { liveBroadcastContent: 'upcoming', scheduledStartTime: '2026-06-20T14:00:00Z' }],
    ])
    const byId = Object.fromEntries(
      shapeEventDayStreams(CONFIG, live, TODAY).map(c => [c.videoId, c]),
    )
    expect(byId.day1id.badge).toBe('replay') // none/missing + past
    expect(byId.day2id.badge).toBe('live')
    expect(byId.day3id.badge).toBe('upcoming')
    expect(byId.day3id.scheduledStartTime).toBe('2026-06-20T14:00:00Z')
  })

  it('falls back to date heuristic when live map is empty (API down)', () => {
    const byId = Object.fromEntries(
      shapeEventDayStreams(CONFIG, new Map(), TODAY).map(c => [c.videoId, c]),
    )
    expect(byId.day1id.badge).toBe('replay') // past
    expect(byId.day2id.badge).toBe('replay') // today → no false live
    expect(byId.day3id.badge).toBe('upcoming') // future
  })
})

describe('eventDayStreamConfig', () => {
  it('returns the Reserve Cup config for its slug', () => {
    const c = eventDayStreamConfig('reserve-cup-marbella-2026')
    expect(c).toHaveLength(3)
    expect(c.map(d => d.videoId)).toEqual(['BsofMZlgI2o', '2laxETHywfU', '0AU-20vxFxA'])
  })

  it('returns [] for an unknown slug', () => {
    expect(eventDayStreamConfig('some-other-event')).toEqual([])
  })
})
