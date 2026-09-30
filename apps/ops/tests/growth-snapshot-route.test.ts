// apps/ops/tests/growth-snapshot-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('../src/lib/db', () => ({ pgPool: () => ({ query: queryMock }) }))

import { POST } from '../src/app/api/internal/growth-snapshot/route'

const req = (auth = 'Bearer test-secret', qs = '') =>
  new Request(`http://localhost/api/internal/growth-snapshot${qs}`, { method: 'POST', headers: { authorization: auth } })

describe('POST /api/internal/growth-snapshot', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
    delete process.env.POSTHOG_PERSONAL_API_KEY
    delete process.env.POSTHOG_PROJECT_ID
    queryMock.mockReset()
  })

  it('401 on wrong bearer', async () => {
    expect((await POST(req('Bearer nope'))).status).toBe(401)
  })
  it('400 on malformed day', async () => {
    expect((await POST(req('Bearer test-secret', '?day=yesterday'))).status).toBe(400)
  })
  it('500 posthog_config when the key is missing (and writes nothing)', async () => {
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('posthog_config')
    expect(queryMock).not.toHaveBeenCalled()
  })
})
