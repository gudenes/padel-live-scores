// apps/ops/src/app/api/news-sources/detect/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { isOperator: true, email: 'op@example.com' } }) }))
vi.mock('@/lib/source-detector', () => ({
  detectSource: vi.fn(async (url: string) => ({
    type: 'rss',
    url,
    name: 'Mocked Feed',
    language: 'es',
    sample: [{ title: 'A' }, { title: 'B' }],
  })),
}))

const { POST } = await import('../route')

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/news-sources/detect', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}

describe('POST /api/news-sources/detect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns detected source for a valid URL', async () => {
    const res = await POST(makeReq({ url: 'https://example.com/feed' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.type).toBe('rss')
    expect(json.name).toBe('Mocked Feed')
    expect(json.sample).toHaveLength(2)
  })

  it('returns 400 for invalid url', async () => {
    const res = await POST(makeReq({ url: 'not a url' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_url')
  })

  it('returns 400 for missing url', async () => {
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/news-sources/detect — auth', () => {
  it('returns 401 when not operator', async () => {
    vi.doMock('@/lib/auth', () => ({ auth: async () => null }))
    vi.resetModules()
    const { POST } = await import('../route')
    const res = await POST(makeReq({ url: 'https://example.com/feed' }))
    expect(res.status).toBe(401)
  })
})
