// apps/ops/tests/seo-snapshot-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryMock, gscQueryMock, listSitesMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  gscQueryMock: vi.fn(),
  listSitesMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  pgPool: () => ({ query: queryMock }),
}))

vi.mock('../src/lib/seo/gsc-client', () => ({
  GscClient: {
    fromEnv: () => ({ query: gscQueryMock, listSites: listSitesMock }),
  },
}))

import { POST } from '../src/app/api/internal/seo-snapshot/route'

function makeRequest(headers: Record<string, string> = { authorization: 'Bearer test-secret' }, search = '') {
  return new Request(`http://localhost/api/internal/seo-snapshot${search}`, {
    method: 'POST',
    headers,
  })
}

describe('POST /api/internal/seo-snapshot', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
    queryMock.mockReset()
    gscQueryMock.mockReset()
    listSitesMock.mockReset()
  })

  it('401 when missing bearer', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(401)
  })

  it('401 when wrong bearer', async () => {
    const res = await POST(makeRequest({ authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
  })

  it('ingests 6 locale rows + top queries + top pages, returns counts', async () => {
    // Pull 1: page-level totals — 4 rows across 3 locales
    gscQueryMock.mockResolvedValueOnce([
      { keys: ['https://padelnachos.com/home',           '2026-05-22'], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 },
      { keys: ['https://padelnachos.com/es/home',        '2026-05-22'], clicks: 50,  impressions: 500,  ctr: 0.1, position: 10 },
      { keys: ['https://padelnachos.com/pt/matches/2026','2026-05-22'], clicks: 20,  impressions: 200,  ctr: 0.1, position: 15 },
      { keys: ['https://padelnachos.com/match/abc',      '2026-05-22'], clicks: 5,   impressions: 50,   ctr: 0.1, position: 20 },
    ])
    // Pull 2: top queries — 2 rows
    gscQueryMock.mockResolvedValueOnce([
      { keys: ['padel nachos'],       clicks: 47, impressions: 312,  ctr: 0.15, position: 1.4 },
      { keys: ['premier padel live'], clicks: 31, impressions: 1892, ctr: 0.02, position: 8.2 },
    ])
    // Pull 3: top pages — 2 rows
    gscQueryMock.mockResolvedValueOnce([
      { keys: ['https://padelnachos.com/home'],     clicks: 100, impressions: 1000, ctr: 0.1, position: 5 },
      { keys: ['https://padelnachos.com/es/home'],  clicks: 50,  impressions: 500,  ctr: 0.1, position: 10 },
    ])
    queryMock.mockResolvedValue({ rows: [] })

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }, '?day=2026-05-22'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      day: '2026-05-22',
      locales_written: 6,
      queries_written: 2,
      pages_written: 2,
    })

    // Should have issued at least: 6 upserts to seo_snapshots, 2 to seo_top_queries, 2 to seo_top_pages.
    const upsertCalls = queryMock.mock.calls.map(c => c[0] as string)
    expect(upsertCalls.filter(s => s.includes('seo_snapshots')).length).toBeGreaterThanOrEqual(6)
    expect(upsertCalls.filter(s => s.includes('seo_top_queries')).length).toBeGreaterThanOrEqual(2)
    expect(upsertCalls.filter(s => s.includes('seo_top_pages')).length).toBeGreaterThanOrEqual(2)
  })

  it('supports probe=true to call listSites instead of ingest', async () => {
    listSitesMock.mockResolvedValueOnce([
      { siteUrl: 'https://padelnachos.com/', permissionLevel: 'siteOwner' },
    ])

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }, '?probe=true'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.sites?.[0]?.siteUrl).toBe('https://padelnachos.com/')
    expect(listSitesMock).toHaveBeenCalledTimes(1)
    expect(gscQueryMock).not.toHaveBeenCalled()
  })

  it('defaults targetDay to today − 3 when no ?day is given', async () => {
    gscQueryMock.mockResolvedValue([])
    queryMock.mockResolvedValue({ rows: [] })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    const expected = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10)
    expect(body.day).toBe(expected)
  })
})
