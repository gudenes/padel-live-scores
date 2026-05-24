import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, serviceClientMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))

import { GET } from '../route'

function buildSupabaseStub(opts: {
  diffEvents: Array<{ agreement: string; lag_seconds: number | null }>
  snapshots: Array<{ ocr_confidence: number | null }>
}) {
  let call = 0
  return {
    schema: vi.fn().mockReturnThis(),
    from: vi.fn(function (this: any) {
      call += 1
      return this
    }),
    select: vi.fn().mockReturnThis(),
    gte: vi.fn(function (this: any) {
      // First .from('ocr_diff_events') chain returns diffEvents;
      // second .from('ocr_snapshots') chain returns snapshots.
      const promise = call === 1
        ? Promise.resolve({ data: opts.diffEvents, error: null })
        : Promise.resolve({ data: opts.snapshots, error: null })
      return promise
    }),
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

  it('returns agreement counts and match rate', async () => {
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
          { ocr_confidence: 0.9 },
          { ocr_confidence: 0.8 },
          { ocr_confidence: null },
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
  })
})
