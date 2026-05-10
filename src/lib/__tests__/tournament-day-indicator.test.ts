import { describe, it, expect } from 'vitest'
import {
  shouldShowDayIndicator,
  formatDayChipLabel,
} from '../tournament-day-indicator'

// Asunción semifinal that wrapped at 23:00 ART Saturday 2026-05-09
// = 04:00 Lisbon Sunday 2026-05-10. User opens HOJE 10 mai. tab —
// the match's tournament-local day was Saturday, user-local day is
// Sunday. Chip should fire.
const ASUNCION_TZ = 'America/Asuncion'
const FINISHED_AT_AS_SF = '2026-05-10T02:00:00Z' // 23:00 ART Sat / 03:00 Lisbon Sun
const FINISHED_AT_SAME_DAY = '2026-05-10T19:00:00Z' // 16:00 ART Sun, 20:00 Lisbon Sun

describe('shouldShowDayIndicator', () => {
  it('returns true when tournament-local date is earlier than dayBucketIso', () => {
    expect(
      shouldShowDayIndicator({
        status: 'finished',
        finishedAt: FINISHED_AT_AS_SF,
        scheduledAt: null,
        tournamentTimezone: ASUNCION_TZ,
        dayBucketIso: '2026-05-10',
      }),
    ).toBe(true)
  })

  it('returns false when tournament-local date matches dayBucketIso', () => {
    expect(
      shouldShowDayIndicator({
        status: 'finished',
        finishedAt: FINISHED_AT_SAME_DAY,
        scheduledAt: null,
        tournamentTimezone: ASUNCION_TZ,
        dayBucketIso: '2026-05-10',
      }),
    ).toBe(false)
  })

  it('returns false when tournament-local date matches dayBucketIso (eastward viewer same day)', () => {
    // A user in Tokyo (JST = UTC+9) opens their 2026-05-09 tab. A
    // California tournament (PDT = UTC-7) match that finished at
    // 17:00 PDT 2026-05-09 = 09:00 JST 2026-05-10. The user's local
    // day bucket is 2026-05-09 (their own calendar day in JST).
    // Tournament-local day is also May 9 (PDT) → same → no chip.
    expect(
      shouldShowDayIndicator({
        status: 'finished',
        finishedAt: '2026-05-10T00:00:00Z', // 17:00 PDT Sat May 9
        scheduledAt: null,
        tournamentTimezone: 'America/Los_Angeles',
        dayBucketIso: '2026-05-09', // user-local day bucket (Tokyo user's May 9)
      }),
    ).toBe(false) // tournament local is May 9, dayBucket is May 9 → same → false
  })

  it('returns false for live status', () => {
    expect(
      shouldShowDayIndicator({
        status: 'live',
        finishedAt: null,
        scheduledAt: '2026-05-10T20:00:00Z',
        tournamentTimezone: ASUNCION_TZ,
        dayBucketIso: '2026-05-10',
      }),
    ).toBe(false)
  })

  it('returns false for scheduled status', () => {
    expect(
      shouldShowDayIndicator({
        status: 'scheduled',
        finishedAt: null,
        scheduledAt: '2026-05-10T20:00:00Z',
        tournamentTimezone: ASUNCION_TZ,
        dayBucketIso: '2026-05-10',
      }),
    ).toBe(false)
  })

  it('returns false when tournamentTimezone is null', () => {
    expect(
      shouldShowDayIndicator({
        status: 'finished',
        finishedAt: FINISHED_AT_AS_SF,
        scheduledAt: null,
        tournamentTimezone: null,
        dayBucketIso: '2026-05-10',
      }),
    ).toBe(false)
  })

  it('returns false when dayBucketIso is undefined', () => {
    expect(
      shouldShowDayIndicator({
        status: 'finished',
        finishedAt: FINISHED_AT_AS_SF,
        scheduledAt: null,
        tournamentTimezone: ASUNCION_TZ,
        dayBucketIso: undefined,
      }),
    ).toBe(false)
  })

  it('falls back to scheduledAt when finishedAt is null', () => {
    expect(
      shouldShowDayIndicator({
        status: 'finished',
        finishedAt: null,
        scheduledAt: FINISHED_AT_AS_SF,
        tournamentTimezone: ASUNCION_TZ,
        dayBucketIso: '2026-05-10',
      }),
    ).toBe(true)
  })

  it('returns false when both timestamps are null', () => {
    expect(
      shouldShowDayIndicator({
        status: 'finished',
        finishedAt: null,
        scheduledAt: null,
        tournamentTimezone: ASUNCION_TZ,
        dayBucketIso: '2026-05-10',
      }),
    ).toBe(false)
  })

  it('also fires for retired and walkover (terminal statuses)', () => {
    for (const status of ['retired', 'walkover', 'ended'] as const) {
      expect(
        shouldShowDayIndicator({
          status,
          finishedAt: FINISHED_AT_AS_SF,
          scheduledAt: null,
          tournamentTimezone: ASUNCION_TZ,
          dayBucketIso: '2026-05-10',
        }),
      ).toBe(true)
    }
  })
})

describe('formatDayChipLabel', () => {
  it('returns localised short weekday + day + month in tournament tz (en)', () => {
    // 2026-05-10T02:00:00Z = Saturday 9 May at 23:00 ART
    const label = formatDayChipLabel({
      timestamp: FINISHED_AT_AS_SF,
      tournamentTimezone: ASUNCION_TZ,
      locale: 'en',
    })
    expect(label).toMatch(/Sat/)
    expect(label).toMatch(/9/)
    expect(label).toMatch(/May/)
  })

  it('returns localised short weekday + day + month in tournament tz (pt)', () => {
    const label = formatDayChipLabel({
      timestamp: FINISHED_AT_AS_SF,
      tournamentTimezone: ASUNCION_TZ,
      locale: 'pt',
    })
    // Portuguese short weekday for Saturday is "sáb" or "Sáb"
    expect(label!.toLowerCase()).toMatch(/sáb|sab/)
    expect(label).toMatch(/9/)
    // Portuguese short month for May is "mai"
    expect(label!.toLowerCase()).toMatch(/mai/)
  })

  it('returns null when timestamp is null', () => {
    expect(
      formatDayChipLabel({
        timestamp: null,
        tournamentTimezone: ASUNCION_TZ,
        locale: 'en',
      }),
    ).toBeNull()
  })

  it('returns null when tournamentTimezone is null', () => {
    expect(
      formatDayChipLabel({
        timestamp: FINISHED_AT_AS_SF,
        tournamentTimezone: null,
        locale: 'en',
      }),
    ).toBeNull()
  })
})
