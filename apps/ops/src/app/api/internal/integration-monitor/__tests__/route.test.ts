import { beforeEach, describe, expect, it, vi } from 'vitest'
const { authMock, clientMock } = vi.hoisted(() => ({ authMock: vi.fn(), clientMock: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: clientMock }))
import { GET } from '../route'
beforeEach(() => { vi.clearAllMocks() })
describe('monitor API authorization and partial failures', () => {
  it('rejects non-operators before querying any integration', async () => {
    authMock.mockResolvedValue({ user: { isOperator: false } })
    expect((await GET()).status).toBe(401)
    expect(clientMock).not.toHaveBeenCalled()
  })
  it('returns unknown history and an unavailable worker without leaking upstream errors', async () => {
    authMock.mockResolvedValue({ user: { isOperator: true } })
    clientMock.mockImplementation(() => { throw new Error('secret-database-url') })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('secret-proxy-password'))
    try {
      const response = await GET(); const body = await response.json()
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(body.runtime.status).toBe('error')
      expect(body.feeds.every((feed: { status: string }) => feed.status === 'unknown')).toBe(true)
      expect(JSON.stringify(body)).not.toContain('secret-')
    } finally { fetchMock.mockRestore() }
  })
})
