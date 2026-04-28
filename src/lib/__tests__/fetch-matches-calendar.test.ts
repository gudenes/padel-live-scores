import { describe, it, expect, vi } from 'vitest'
import {
  fetchMatchesCalendar,
  nextDayWithMatches,
} from '../fetch-matches-calendar'

// ── nextDayWithMatches ─────────────────────────────────────────────
//
// The pure helper that powers the empty-state CTA. Given a sorted ISO
// list of "days that have matches" and a target start date, returns
// the first day at or after the target. Linear scan — O(n) is fine
// since the list caps at 30 entries.

describe('nextDayWithMatches', () => {
  it('returns the first day at or after fromIso', () => {
    const days = ['2026-04-28', '2026-04-30', '2026-05-02', '2026-05-04']
    expect(nextDayWithMatches(days, '2026-04-29')).toBe('2026-04-30')
  })

  it('returns the exact match when fromIso is in the list', () => {
    const days = ['2026-05-01', '2026-05-04']
    expect(nextDayWithMatches(days, '2026-05-01')).toBe('2026-05-01')
  })

  it('returns null when nothing is at or after fromIso', () => {
    const days = ['2026-04-25', '2026-04-26']
    expect(nextDayWithMatches(days, '2026-05-01')).toBeNull()
  })

  it('returns null on an empty list', () => {
    expect(nextDayWithMatches([], '2026-04-28')).toBeNull()
  })

  it('handles fromIso before all entries (returns first)', () => {
    const days = ['2026-04-30', '2026-05-01']
    expect(nextDayWithMatches(days, '2026-04-01')).toBe('2026-04-30')
  })
})

// ── fetchMatchesCalendar ───────────────────────────────────────────
//
// The Supabase-side pull. We mock the client to verify:
// 1. The query window is [today, today+30) in the locale's home tz
// 2. Same-day scheduled_at instants bucket together
// 3. maxScheduledIso is the chronologically latest day (ISO sorting
//    is the same as chronological sorting for YYYY-MM-DD)
// 4. A DB error degrades to an empty calendar (never throws)

interface FakeQuery {
  table: string
  filters: Array<[string, ...unknown[]]>
  resolveWith: { data: unknown[] | null; error: { message: string } | null }
}

function makeFakeSupabase(scheduledAtRows: Array<string | null>, error: string | null = null): { client: any; capturedQuery: FakeQuery } {
  const captured: FakeQuery = {
    table: '',
    filters: [],
    resolveWith: { data: null, error: null },
  }

  const builder: any = {
    select: (cols: string) => {
      captured.filters.push(['select', cols])
      return builder
    },
    not: (col: string, op: string, val: unknown) => {
      captured.filters.push(['not', col, op, val])
      return builder
    },
    gte: (col: string, val: unknown) => {
      captured.filters.push(['gte', col, val])
      return builder
    },
    lt: (col: string, val: unknown) => {
      captured.filters.push(['lt', col, val])
      return builder
    },
    limit: (n: number) => {
      captured.filters.push(['limit', n])
      const data = error
        ? null
        : scheduledAtRows.map((s) => ({ scheduled_at: s }))
      const err = error ? { message: error } : null
      return Promise.resolve({ data, error: err })
    },
  }

  const client = {
    from: (table: string) => {
      captured.table = table
      return builder
    },
  }

  return { client, capturedQuery: captured }
}

describe('fetchMatchesCalendar', () => {
  // Pin "now" so window calc is deterministic. 12:00 UTC on 2026-04-28
  // — comfortably inside both Europe/Madrid (UTC+2) and UTC days.
  const NOW = new Date('2026-04-28T12:00:00Z')

  it('queries [today, today+30) in matches.scheduled_at', async () => {
    const { client, capturedQuery } = makeFakeSupabase([])
    await fetchMatchesCalendar(client, 'en', 'UTC', NOW)

    expect(capturedQuery.table).toBe('matches')
    const gte = capturedQuery.filters.find((f) => f[0] === 'gte')
    const lt = capturedQuery.filters.find((f) => f[0] === 'lt')
    expect(gte).toBeDefined()
    expect(lt).toBeDefined()
    // Window is [2026-04-28T00:00 UTC, 2026-05-28T00:00 UTC).
    expect(gte![2]).toBe('2026-04-28T00:00:00.000Z')
    expect(lt![2]).toBe('2026-05-28T00:00:00.000Z')
  })

  it('buckets multiple scheduled_at instants into single days', async () => {
    const { client } = makeFakeSupabase([
      '2026-04-28T10:00:00Z',
      '2026-04-28T15:00:00Z', // same day
      '2026-04-29T09:00:00Z',
      '2026-05-02T14:00:00Z',
    ])
    const result = await fetchMatchesCalendar(client, 'en', 'UTC', NOW)
    expect(result.daysWithMatches).toEqual([
      '2026-04-28',
      '2026-04-29',
      '2026-05-02',
    ])
    expect(result.maxScheduledIso).toBe('2026-05-02')
    expect(result.todayIso).toBe('2026-04-28')
  })

  it('returns sorted ascending output', async () => {
    // Feed rows in random order — bucketing should sort.
    const { client } = makeFakeSupabase([
      '2026-05-04T10:00:00Z',
      '2026-04-29T10:00:00Z',
      '2026-05-01T10:00:00Z',
    ])
    const result = await fetchMatchesCalendar(client, 'en', 'UTC', NOW)
    expect(result.daysWithMatches).toEqual([
      '2026-04-29',
      '2026-05-01',
      '2026-05-04',
    ])
    expect(result.maxScheduledIso).toBe('2026-05-04')
  })

  it('returns empty calendar when no rows match', async () => {
    const { client } = makeFakeSupabase([])
    const result = await fetchMatchesCalendar(client, 'en', 'UTC', NOW)
    expect(result.daysWithMatches).toEqual([])
    expect(result.maxScheduledIso).toBeNull()
  })

  it('soft-fails on DB error: empty calendar, no throw', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = makeFakeSupabase([], 'connection refused')
    const result = await fetchMatchesCalendar(client, 'en', 'UTC', NOW)
    expect(result.daysWithMatches).toEqual([])
    expect(result.maxScheduledIso).toBeNull()
    expect(result.todayIso).toBe('2026-04-28')
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('respects locale tz when bucketing into days', async () => {
    // 2026-04-28T23:00 UTC is already 2026-04-29 in Asia/Singapore (UTC+8).
    // That match should bucket as 2026-04-29 from a Singapore-anchored
    // user's POV. Here we use Europe/Madrid (UTC+2) and a 23:00Z match
    // → 01:00 next day Madrid time.
    const { client } = makeFakeSupabase([
      '2026-04-28T23:00:00Z',
    ])
    const result = await fetchMatchesCalendar(
      client,
      'es',
      'Europe/Madrid',
      NOW,
    )
    expect(result.daysWithMatches).toEqual(['2026-04-29'])
  })
})
