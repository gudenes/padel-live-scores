import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => ({ user: { isOperator: true } })),
}))

const queryMock = vi.fn()
vi.mock('@/lib/db', () => ({ pgPool: () => ({ query: queryMock }) }))

import { POST } from '../route'

beforeEach(() => queryMock.mockReset())

describe('POST /api/internal/player-aliases', () => {
  it('rejects missing fields with 400', async () => {
    const res = await POST(new Request('http://x/', { method: 'POST', body: JSON.stringify({}) }))
    expect(res.status).toBe(400)
  })

  it('upserts an alias and returns ok', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] })
    const res = await POST(new Request('http://x/', {
      method: 'POST',
      body: JSON.stringify({ playerId: 'u-ruiz', alias: 'Alejandro Ruiz Granados' }),
    }))
    expect(res.status).toBe(200)
    expect(queryMock).toHaveBeenCalledTimes(1)
    const sql = queryMock.mock.calls[0][0] as string
    expect(sql).toMatch(/insert into public\.entity_external_ids/i)
    expect(sql).toMatch(/on conflict/i)
  })
})
