// apps/ops/tests/seo-digest-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryMock, sendMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  sendMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  pgPool: () => ({ query: queryMock }),
}))

vi.mock('resend', () => ({
  Resend: class { emails = { send: sendMock } },
}))

import { POST } from '../src/app/api/internal/seo-digest/route'

const makeReq = (auth = 'Bearer test-secret') =>
  new Request('http://localhost/api/internal/seo-digest', {
    method: 'POST',
    headers: { authorization: auth },
  })

describe('POST /api/internal/seo-digest', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
    process.env.RESEND_API_KEY = 'test-key'
    process.env.SEO_DIGEST_RECIPIENTS = 'gustavo@padellabs.tech'
    queryMock.mockReset()
    sendMock.mockReset()
  })

  it('401 on wrong bearer', async () => {
    const res = await POST(makeReq('Bearer wrong'))
    expect(res.status).toBe(401)
  })

  it('skips if today already sent', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ status: 'sent' }] })  // existing send check
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped).toBe('already_sent')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('sends digest and records audit row', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })  // existing send check
      .mockResolvedValueOnce({ rows: [{ day: '2026-05-22', fetched_at: new Date().toISOString() }] })  // latest ingest
      .mockResolvedValueOnce({ rows: [
        // 7d window — 6 locales
        { day: '2026-05-22', locale: 'total', clicks: 1000, impressions: 50000, avg_position: 12, ctr: 0.02 },
        { day: '2026-05-22', locale: 'en',    clicks: 700,  impressions: 35000, avg_position: 10, ctr: 0.02 },
        { day: '2026-05-22', locale: 'es',    clicks: 200,  impressions: 10000, avg_position: 15, ctr: 0.02 },
        { day: '2026-05-22', locale: 'pt',    clicks: 60,   impressions: 3000,  avg_position: 18, ctr: 0.02 },
        { day: '2026-05-22', locale: 'it',    clicks: 30,   impressions: 1500,  avg_position: 20, ctr: 0.02 },
        { day: '2026-05-22', locale: 'fr',    clicks: 10,   impressions: 500,   avg_position: 25, ctr: 0.02 },
      ]})
      .mockResolvedValueOnce({ rows: [] })  // sitemap delta query
      .mockResolvedValueOnce({ rows: [] })  // getLocaleGaps inner query
      .mockResolvedValueOnce({ rows: [] })  // insert audit row

    sendMock.mockResolvedValue({ id: 'resend-id' })

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      to: ['gustavo@padellabs.tech'],
    })
  })
})
