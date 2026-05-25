import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => ({ user: { isOperator: true } })),
}))

const queryMock = vi.fn()
vi.mock('@/lib/db', () => ({ pgPool: () => ({ query: queryMock }) }))

import { POST } from '../route'

beforeEach(() => queryMock.mockReset())

describe('POST /api/internal/players', () => {
  it('rejects missing name with 400', async () => {
    const res = await POST(new Request('http://x/', { method: 'POST', body: JSON.stringify({}) }))
    expect(res.status).toBe(400)
  })

  it('inserts a player and auto-aliases the source name', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'new-1' }] }) // INSERT players
    queryMock.mockResolvedValueOnce({ rows: [] })                 // INSERT alias
    const res = await POST(new Request('http://x/', {
      method: 'POST',
      body: JSON.stringify({ name: 'Martin Muedini', country: 'AL', category: 'men', sourceName: 'Martin Muedini' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('new-1')
    expect(body.aliasWritten).toBe(true)
    expect(queryMock).toHaveBeenCalledTimes(2)
  })
})
