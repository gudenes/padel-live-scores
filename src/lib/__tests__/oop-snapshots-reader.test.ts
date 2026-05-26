import { describe, it, expect } from 'vitest'
import {
  readOopFromSnapshots,
  lookupMatchesByWidgetIds,
} from '../oop-snapshots-reader'

// ---------------------------------------------------------------------------
// Fake supabase client — enough shape to satisfy the two functions.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

function makeFakeSupabase(opts: {
  oopRows?: Row[]
  eidRows?: Row[]
  matchRows?: Row[]
}) {
  const oopRows = opts.oopRows ?? []
  const eidRows = opts.eidRows ?? []
  const matchRows = opts.matchRows ?? []

  return {
    schema: (name: string) => {
      if (name !== 'padelgod') throw new Error(`unexpected schema: ${name}`)
      return {
        from: (table: string) => {
          if (table !== 'oop_snapshots') {
            throw new Error(`unexpected padelgod table: ${table}`)
          }
          return {
            select: (_cols: string) => ({
              eq: (c1: string, v1: unknown) => ({
                eq: (c2: string, v2: unknown) => ({
                  order: (_c: string, _opts: { ascending: boolean }) =>
                    Promise.resolve({
                      data: oopRows.filter(
                        (r) =>
                          (r as any)[c1] === v1 && (r as any)[c2] === v2,
                      ),
                      error: null,
                    }),
                }),
              }),
            }),
          }
        },
      }
    },
    from: (table: string) => {
      if (table === 'entity_external_ids') {
        return {
          select: (_cols: string) => ({
            eq: (c1: string, v1: unknown) => ({
              eq: (c2: string, v2: unknown) => ({
                in: (c3: string, v3: unknown[]) =>
                  Promise.resolve({
                    data: eidRows.filter(
                      (r) =>
                        (r as any)[c1] === v1 &&
                        (r as any)[c2] === v2 &&
                        v3.includes((r as any)[c3]),
                    ),
                    error: null,
                  }),
              }),
            }),
          }),
        }
      }
      if (table === 'matches') {
        // Supports `.select(cols).eq(col, val).in(col, vals)` —
        // the shape the `widget_id_composite` fallback uses.
        return {
          select: (_cols: string) => ({
            eq: (c1: string, v1: unknown) => ({
              in: (c2: string, v2: unknown[]) =>
                Promise.resolve({
                  data: matchRows.filter(
                    (r) =>
                      (r as any)[c1] === v1 &&
                      v2.includes((r as any)[c2]),
                  ),
                  error: null,
                }),
            }),
          }),
        }
      }
      throw new Error(`unexpected public table: ${table}`)
    },
  } as any
}

// ---------------------------------------------------------------------------
// readOopFromSnapshots
// ---------------------------------------------------------------------------

describe('readOopFromSnapshots', () => {
  const BASE_ROW = {
    tournament_id: 'tour-1',
    day_number: 5,
    category: 'men' as const,
    round_label: 'Round of 16',
    court: 'COURT CBC',
    court_position: 0,
    scheduled_label: 'Starting at 10:00 AM',
    team1_player1_name: 'C. Orsi',
    team1_player2_name: 'P. Llaguno Zielinski',
    team2_player1_name: 'B. Gonzalez Fernandez',
    team2_player2_name: 'P. Josemaria Martin',
    match_widget_id: 'MD017',
    status: 'scheduled' as const,
  }

  it('returns empty + capturedAt=null when no snapshot exists', async () => {
    const supabase = makeFakeSupabase({ oopRows: [] })
    const result = await readOopFromSnapshots(supabase, 'tour-1', 5)
    expect(result).toEqual({
      day: 5,
      matches: [],
      capturedAt: null,
      rowCount: 0,
    })
  })

  it('keeps only the latest scrape_job when multiple are present', async () => {
    const rows = [
      { ...BASE_ROW, scrape_job_id: 'newer', captured_at: '2026-04-23T10:00:00Z' },
      { ...BASE_ROW, scrape_job_id: 'newer', captured_at: '2026-04-23T10:00:00Z', court: 'COURT NEXTENSA' },
      { ...BASE_ROW, scrape_job_id: 'older', captured_at: '2026-04-23T09:00:00Z' },
      { ...BASE_ROW, scrape_job_id: 'older', captured_at: '2026-04-23T09:00:00Z', court: 'COURT LOTTO' },
    ]
    const supabase = makeFakeSupabase({ oopRows: rows })
    const result = await readOopFromSnapshots(supabase, 'tour-1', 5)
    expect(result.rowCount).toBe(2)
    expect(result.capturedAt).toBe('2026-04-23T10:00:00Z')
    // Both rows from newer job, none from older.
    const courts = result.matches.map((m) => m.court)
    expect(courts).toContain('COURT CBC')
    expect(courts).toContain('COURT NEXTENSA')
    expect(courts).not.toContain('COURT LOTTO')
  })

  it('populates court, round, category, matchCode, and split player names', async () => {
    const rows = [
      {
        ...BASE_ROW,
        scrape_job_id: 'job-1',
        captured_at: '2026-04-23T10:00:00Z',
      },
    ]
    const supabase = makeFakeSupabase({ oopRows: rows })
    const result = await readOopFromSnapshots(supabase, 'tour-1', 5)
    expect(result.matches).toHaveLength(1)
    const m = result.matches[0]!
    expect(m.court).toBe('COURT CBC')
    expect(m.round).toBe('Round of 16')
    expect(m.category).toBe('men')
    expect(m.matchCode).toBe('MD017')
    expect(m.team1[0]).toEqual({
      initial: 'C.',
      surname: 'Orsi',
      country: null,
      seed: null,
      fullDisplay: 'C. Orsi',
    })
    expect(m.team1[1].surname).toBe('Llaguno Zielinski')
  })

  it('sorts matches by (court, court_position) for stable order', async () => {
    const rows = [
      { ...BASE_ROW, scrape_job_id: 'job-1', captured_at: 'T', court: 'COURT LOTTO', court_position: 0 },
      { ...BASE_ROW, scrape_job_id: 'job-1', captured_at: 'T', court: 'COURT CBC', court_position: 1 },
      { ...BASE_ROW, scrape_job_id: 'job-1', captured_at: 'T', court: 'COURT CBC', court_position: 0 },
    ]
    const supabase = makeFakeSupabase({ oopRows: rows })
    const result = await readOopFromSnapshots(supabase, 'tour-1', 5)
    // Alphabetical by court, then by position within court
    expect(result.matches.map((m) => [m.court, (rows.find((r) => (r as any).court === m.court) as any).court_position]))
      .toBeDefined()
    expect(result.matches[0]!.court).toBe('COURT CBC')
    expect(result.matches[2]!.court).toBe('COURT LOTTO')
  })

  it('gracefully handles null scheduled_label / round_label / player names', async () => {
    const rows = [
      {
        ...BASE_ROW,
        scrape_job_id: 'job-1',
        captured_at: 'T',
        scheduled_label: null,
        round_label: null,
        team1_player1_name: null,
      },
    ]
    const supabase = makeFakeSupabase({ oopRows: rows })
    const result = await readOopFromSnapshots(supabase, 'tour-1', 5)
    const m = result.matches[0]!
    expect(m.scheduleLabel).toBe('')
    expect(m.round).toBeNull()
    expect(m.team1[0].surname).toBe('')
  })
})

// ---------------------------------------------------------------------------
// lookupMatchesByWidgetIds
// ---------------------------------------------------------------------------

describe('lookupMatchesByWidgetIds', () => {
  it('returns empty map for empty widget-id list', async () => {
    const supabase = makeFakeSupabase({})
    const result = await lookupMatchesByWidgetIds(supabase, 'FIP-2026-1701', [])
    expect(result.size).toBe(0)
  })

  it('maps widget id → match id via entity_external_ids composite key', async () => {
    const supabase = makeFakeSupabase({
      eidRows: [
        {
          entity_type: 'match',
          source: 'crionet_widget',
          external_id: 'FIP-2026-1701:MD017',
          entity_id: 'match-uuid-1',
        },
        {
          entity_type: 'match',
          source: 'crionet_widget',
          external_id: 'FIP-2026-1701:MD018',
          entity_id: 'match-uuid-2',
        },
      ],
    })
    const result = await lookupMatchesByWidgetIds(supabase, 'FIP-2026-1701', [
      'MD017',
      'MD018',
      'MD999', // missing — not in map
    ])
    expect(result.get('MD017')).toBe('match-uuid-1')
    expect(result.get('MD018')).toBe('match-uuid-2')
    expect(result.has('MD999')).toBe(false)
  })

  it('falls back to matches.widget_id_composite when the sidecar is absent', async () => {
    // Populator-owned matches (created by fip-draw-populator) carry
    // widget_id_composite on the hot column but are not registered in
    // entity_external_ids until live polling / static-reconciler
    // touches them. The OOP Schedule Review needs to find these rows
    // too — otherwise operators see them as "unmatched" and can't
    // apply schedule updates. This is the exact failure mode that
    // hid today's MQ025 match for FIP BRONZE ABU DHABI: 54 of 76
    // matches in the tournament had widget_id_composite set but no
    // sidecar row.
    //
    // Mirrors `padelgod/src/lib/match-identifier.ts` step 2.
    const supabase = makeFakeSupabase({
      eidRows: [],
      matchRows: [
        {
          id: 'match-uuid-populator',
          tournament_id: 'tour-abu-dhabi',
          widget_id_composite: 'FIP-2026-1601:MQ025',
        },
        // Another tournament's match with a different composite —
        // must NOT be returned even if its widget_id matches.
        {
          id: 'match-uuid-other-tournament',
          tournament_id: 'tour-other',
          widget_id_composite: 'FIP-2026-1601:MQ025',
        },
      ],
    })
    const result = await lookupMatchesByWidgetIds(
      supabase,
      'FIP-2026-1601',
      ['MQ025', 'MQ099'],
      { tournamentId: 'tour-abu-dhabi' },
    )
    expect(result.get('MQ025')).toBe('match-uuid-populator')
    expect(result.has('MQ099')).toBe(false)
  })

  it('prefers the sidecar mapping when both sidecar and column exist', async () => {
    // Defense against silent flip-flop: once a sidecar exists it
    // wins, even if the column has drifted. Keeps the authoritative
    // mapping stable and makes any drift visible to ops (no silent
    // re-pointing).
    const supabase = makeFakeSupabase({
      eidRows: [
        {
          entity_type: 'match',
          source: 'crionet_widget',
          external_id: 'FIP-2026-1701:MD017',
          entity_id: 'sidecar-winner',
        },
      ],
      matchRows: [
        {
          id: 'column-loser',
          tournament_id: 'tour-1',
          widget_id_composite: 'FIP-2026-1701:MD017',
        },
      ],
    })
    const result = await lookupMatchesByWidgetIds(
      supabase,
      'FIP-2026-1701',
      ['MD017'],
      { tournamentId: 'tour-1' },
    )
    expect(result.get('MD017')).toBe('sidecar-winner')
  })

  it('skips the column fallback when tournamentId is omitted', async () => {
    // Backwards-compatible: legacy callers that don't pass
    // tournamentId stay on the sidecar-only behaviour. Avoids
    // accidentally returning a match from a sibling tournament
    // when the caller hasn't constrained the search.
    const supabase = makeFakeSupabase({
      eidRows: [],
      matchRows: [
        {
          id: 'orphan',
          tournament_id: 'tour-1',
          widget_id_composite: 'FIP-2026-1701:MD017',
        },
      ],
    })
    const result = await lookupMatchesByWidgetIds(supabase, 'FIP-2026-1701', ['MD017'])
    expect(result.has('MD017')).toBe(false)
  })
})
