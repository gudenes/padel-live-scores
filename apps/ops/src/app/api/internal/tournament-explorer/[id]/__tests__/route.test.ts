import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => ({ user: { isOperator: true, email: 'op@example.com' } })),
}))

const mockPayload = vi.fn()
vi.mock('@/lib/entry-list-aggregator', () => ({
  getEntryListPayload: (id: string) => mockPayload(id),
}))

import { GET } from '../route'

beforeEach(() => {
  mockPayload.mockReset()
})

describe('GET /api/internal/tournament-explorer/[id]', () => {
  it('returns 401 when not an operator', async () => {
    const { auth } = await import('@/lib/auth')
    vi.mocked(auth).mockResolvedValueOnce({ user: { isOperator: false } } as any)
    const res = await GET(new Request('http://x/'), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 when tournament not found', async () => {
    mockPayload.mockResolvedValueOnce(null)
    const res = await GET(new Request('http://x/'), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(404)
  })

  it('returns the entry list payload', async () => {
    mockPayload.mockResolvedValueOnce({
      tournament: { id: 't1', name: 'X' },
      capturedAt: null,
      source: 'padelgod.entry_list_snapshots',
      categories: [],
    })
    const res = await GET(new Request('http://x/'), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tournament.id).toBe('t1')
  })
})
