import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, serviceClientMock, readFileMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
  readFileMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))
vi.mock('node:fs/promises', () => ({ readFile: readFileMock }))

import { GET } from '../route'

const SAMPLE_CALIBRATION = {
  stream_label: 'premier_padel_mid_set_1',
  scoreboard_bbox: [100, 60, 460, 60],
  row_layout: 'two_pair_horizontal',
  pair_label_column: { x: 0, width: 270 },
  set_columns: [],
  current_set_column: { x: 298, width: 25 },
  current_game_column: { x: 325, width: 55 },
}

interface SnapshotRow {
  id: number
  captured_at: string
  frame_at: string
  stream_label: string
  youtube_video_id: string
  court_label: string | null
  match_id: string | null
  tournament_id: string | null
  ocr_confidence: number | null
  parsed_score: Record<string, unknown>
  raw_text: string | null
  worker_version: string
  frame_storage_path: string | null
}

function buildSupabaseStub(opts: {
  snapshot: SnapshotRow | null
  snapshotError?: { message: string } | null
  signedUrl?: string | null
  signError?: { message: string } | null
}) {
  return {
    schema: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data: opts.snapshot,
        error: opts.snapshotError ?? null,
      }),
    ),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(() =>
          Promise.resolve({
            data: opts.signedUrl ? { signedUrl: opts.signedUrl } : null,
            error: opts.signError ?? null,
          }),
        ),
      })),
    },
  }
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/internal/ocr-snapshot/[id]', () => {
  beforeEach(() => {
    authMock.mockReset()
    serviceClientMock.mockReset()
    readFileMock.mockReset()
  })

  it('returns 401 when no operator session', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: false } })
    const res = await GET(new Request('http://x/'), params('1'))
    expect(res.status).toBe(401)
  })

  it('returns 400 on non-numeric id', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true } })
    const res = await GET(new Request('http://x/'), params('not-a-number'))
    expect(res.status).toBe(400)
  })

  it('returns 404 when snapshot row missing', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true } })
    serviceClientMock.mockReturnValueOnce(buildSupabaseStub({ snapshot: null }))
    const res = await GET(new Request('http://x/'), params('42'))
    expect(res.status).toBe(404)
  })

  it('returns snapshot + signed URL + calibration on happy path', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true } })
    const snapshot: SnapshotRow = {
      id: 42,
      captured_at: '2026-05-24T18:53:00Z',
      frame_at: '2026-05-24T18:52:59Z',
      stream_label: 'premier_padel_mid_set_1',
      youtube_video_id: 'PlesWHaaGMg',
      court_label: 'Center Court',
      match_id: null,
      tournament_id: null,
      ocr_confidence: 0.92,
      parsed_score: {
        pair1_label: 'SANCHEZ / USTERO',
        pair2_label: 'CASTELLO / RUFO',
        current_set_games: '2-0',
        current_game: '30-0',
        parse_error: false,
      },
      raw_text: null,
      worker_version: 'abc1234',
      frame_storage_path: 'snapshots/42.png',
    }
    serviceClientMock.mockReturnValueOnce(
      buildSupabaseStub({
        snapshot,
        signedUrl: 'https://x.supabase.co/sign/abc',
      }),
    )
    readFileMock.mockResolvedValueOnce(JSON.stringify(SAMPLE_CALIBRATION))

    const res = await GET(new Request('http://x/'), params('42'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.snapshot.id).toBe(42)
    expect(body.frameUrl).toBe('https://x.supabase.co/sign/abc')
    expect(body.calibration.scoreboard_bbox).toEqual([100, 60, 460, 60])
    expect(body.calibration.current_set_column).toEqual({ x: 298, width: 25 })
    expect(body.calibrationError).toBeNull()
  })

  it('returns null frameUrl when no frame was retained', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true } })
    const snapshot: SnapshotRow = {
      id: 7,
      captured_at: '2026-05-24T18:53:00Z',
      frame_at: '2026-05-24T18:52:59Z',
      stream_label: 'premier_padel_mid_set_1',
      youtube_video_id: 'PlesWHaaGMg',
      court_label: null,
      match_id: null,
      tournament_id: null,
      ocr_confidence: 0.92,
      parsed_score: { parse_error: false },
      raw_text: null,
      worker_version: 'abc1234',
      frame_storage_path: null, // no frame retained
    }
    serviceClientMock.mockReturnValueOnce(buildSupabaseStub({ snapshot }))
    readFileMock.mockResolvedValueOnce(JSON.stringify(SAMPLE_CALIBRATION))

    const res = await GET(new Request('http://x/'), params('7'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.frameUrl).toBeNull()
    expect(body.calibration).toBeTruthy()
  })

  it('returns null calibration with error message when JSON missing', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true } })
    const snapshot: SnapshotRow = {
      id: 9,
      captured_at: '2026-05-24T18:53:00Z',
      frame_at: '2026-05-24T18:52:59Z',
      stream_label: 'unknown_stream',
      youtube_video_id: 'xxx',
      court_label: null,
      match_id: null,
      tournament_id: null,
      ocr_confidence: 0.92,
      parsed_score: { parse_error: false },
      raw_text: null,
      worker_version: 'abc1234',
      frame_storage_path: 'snapshots/9.png',
    }
    serviceClientMock.mockReturnValueOnce(
      buildSupabaseStub({
        snapshot,
        signedUrl: 'https://x.supabase.co/sign/abc',
      }),
    )
    readFileMock.mockRejectedValueOnce(new Error('ENOENT: no such file'))

    const res = await GET(new Request('http://x/'), params('9'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.calibration).toBeNull()
    expect(body.calibrationError).toMatch(/ENOENT/)
    // frameUrl still flows because storage signing is independent of file read
    expect(body.frameUrl).toBe('https://x.supabase.co/sign/abc')
  })

  it('returns 500 on database error', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true } })
    serviceClientMock.mockReturnValueOnce(
      buildSupabaseStub({
        snapshot: null,
        snapshotError: { message: 'connection refused' },
      }),
    )
    const res = await GET(new Request('http://x/'), params('1'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('connection refused')
  })
})
