import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => ({ user: { isOperator: true } })),
}))

const queryMock = vi.fn()
vi.mock('@/lib/db', () => ({ pgPool: () => ({ query: queryMock }) }))

import { GET } from '../route'

beforeEach(() => queryMock.mockReset())

describe('GET /api/internal/players/search', () => {
  it('returns matching players scoped by category', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'u1', name: 'Alejandro Ruiz', country: 'ES', ranking: 23, fip_id: 'P000012' }],
    })
    const res = await GET(new Request('http://x/?q=Ruiz&category=men&per_page=10'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.players).toHaveLength(1)
    expect(body.players[0].fip_id).toBe('P000012')
  })

  it('returns 400 when q is empty', async () => {
    const res = await GET(new Request('http://x/?category=men'))
    expect(res.status).toBe(400)
  })
})
