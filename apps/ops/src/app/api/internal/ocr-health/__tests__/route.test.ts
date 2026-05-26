import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, serviceClientMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))

import { GET } from '../route'

interface DiffRow {
  agreement: string
  lag_seconds: number | null
}
interface SnapAggRow {
  ocr_confidence: number | null
  stream_label: string
  parsed_score: Record<string, unknown>
  captured_at: string
}
interface RecentRow {
  id: number
  captured_at: string
  frame_at: string
  stream_label: string
  youtube_video_id: string
  court_label: string | null
  match_id: string | null
  ocr_confidence: number | null
  parsed_score: Record<string, unknown>
  worker_version: string
}

// The route makes 3 queries in order:
//   1. ocr_diff_events  (terminal: .gte)
//   2. ocr_snapshots aggregates (terminal: .gte)
//   3. ocr_snapshots recent (terminal: .limit)
// `buildSupabaseStub` tracks a single shared counter that increments on each
// .from() call, then routes the terminal Promise resolution based on the
// counter value at terminal time.
function buildSupabaseStub(opts: {
  diffEvents: DiffRow[]
  snapshots: SnapAggRow[]
  recentSnapshots?: RecentRow[]
  diffError?: { message: string } | null
  snapError?: { message: string } | null
  recentError?: { message: string } | null
}) {
  let call = 0
  const respond = () => {
    if (call === 1)
      return Promise.resolve({ data: opts.diffEvents, error: opts.diffError ?? null })
    if (call === 2)
      return Promise.resolve({ data: opts.snapshots, error: opts.snapError ?? null })
    return Promise.resolve({
      data: opts.recentSnapshots ?? [],
      error: opts.recentError ?? null,
    })
  }
  return {
    schema: vi.fn().mockReturnThis(),
    from: vi.fn(function (this: any) {
      call += 1
      return this
    }),
    select: vi.fn().mockReturnThis(),
    gte: vi.fn(() => respond()),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(() => respond()),
  }
}

describe('GET /api/internal/ocr-health', () => {
  beforeEach(() => {
    authMock.mockReset()
    serviceClientMock.mockReset()
  })

  it('returns 401 when no operator session', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: false } })
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns agreement counts, match rate, and per-stream rollups', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true, email: 'op@x.com' } })
    serviceClientMock.mockReturnValueOnce(
      buildSupabaseStub({
        diffEvents: [
          { agreement: 'match', lag_seconds: 2 },
          { agreement: 'match', lag_seconds: 3 },
          { agreement: 'sets_disagree', lag_seconds: 4 },
          { agreement: 'no_crionet_baseline', lag_seconds: null },
        ],
        snapshots: [
          {
            ocr_confidence: 0.9,
            stream_label: 'premier_p1',
            parsed_score: { parse_error: false },
            captured_at: '2026-05-24T20:00:00Z',
          },
          {
            ocr_confidence: 0.8,
            stream_label: 'premier_p1',
            parsed_score: { parse_error: false },
            captured_at: '2026-05-24T20:01:00Z',
          },
          {
            ocr_confidence: null,
            stream_label: 'premier_p2',
            parsed_score: { parse_error: true },
            captured_at: '2026-05-24T20:02:00Z',
          },
        ],
        recentSnapshots: [
          {
            id: 1,
            captured_at: '2026-05-24T20:02:00Z',
            frame_at: '2026-05-24T20:01:55Z',
            stream_label: 'premier_p2',
            youtube_video_id: 'abc',
            court_label: null,
            match_id: null,
            ocr_confidence: null,
            parsed_score: { parse_error: true },
            worker_version: 'sha-1',
          },
        ],
      }),
    )

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.totalDiffs).toBe(4)
    expect(json.matchRate).toBeCloseTo(0.5)
    expect(json.agreementCounts.match).toBe(2)
    expect(json.agreementCounts.sets_disagree).toBe(1)
    expect(json.totalSnapshots).toBe(3)
    expect(json.meanConfidence).toBeCloseTo(0.85)
    expect(json.meanLagSeconds).toBeCloseTo(3)

    // Per-stream rollups
    expect(json.streamRollups).toHaveLength(2)
    const p1 = json.streamRollups.find((r: any) => r.stream_label === 'premier_p1')
    const p2 = json.streamRollups.find((r: any) => r.stream_label === 'premier_p2')
    expect(p1.total).toBe(2)
    expect(p1.parsed_ok).toBe(2)
    expect(p1.parsed_error).toBe(0)
    expect(p1.mean_confidence).toBeCloseTo(0.85)
    expect(p2.total).toBe(1)
    expect(p2.parsed_error).toBe(1)
    // ordered by total descending
    expect(json.streamRollups[0].stream_label).toBe('premier_p1')

    // Recent snapshots passed through
    expect(json.recentSnapshots).toHaveLength(1)
    expect(json.recentSnapshots[0].stream_label).toBe('premier_p2')
  })

  it('returns 500 when snapshots aggregate query fails', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true, email: 'op@x.com' } })
    serviceClientMock.mockReturnValueOnce(
      buildSupabaseStub({
        diffEvents: [{ agreement: 'match', lag_seconds: 1 }],
        snapshots: [],
        snapError: { message: 'permission denied on padelgod.ocr_snapshots' },
      }),
    )
    const res = await GET()
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toContain('permission denied')
  })

  it('returns 500 when recent-snapshots query fails', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true, email: 'op@x.com' } })
    serviceClientMock.mockReturnValueOnce(
      buildSupabaseStub({
        diffEvents: [],
        snapshots: [],
        recentError: { message: 'connection terminated' },
      }),
    )
    const res = await GET()
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toContain('connection terminated')
  })

  it('returns empty streamRollups and recentSnapshots gracefully when nothing has been written yet', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true, email: 'op@x.com' } })
    serviceClientMock.mockReturnValueOnce(
      buildSupabaseStub({ diffEvents: [], snapshots: [], recentSnapshots: [] }),
    )
    const res = await GET()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.totalSnapshots).toBe(0)
    expect(json.streamRollups).toEqual([])
    expect(json.recentSnapshots).toEqual([])
    expect(json.meanConfidence).toBeNull()
  })
})
