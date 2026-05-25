import { describe, it, expect, vi, beforeEach } from 'vitest'
import { seedTournamentViaLegacy } from '@/lib/seed-fip-bridge'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => fetchMock.mockReset())

describe('seedTournamentViaLegacy', () => {
  it('POSTs to legacy /api/ops/seed-fip-entry-list with CRON_SECRET cookie', async () => {
    process.env.OPS_PUBLIC_APP_URL = 'https://padelnachos.com'
    process.env.CRON_SECRET = 'test-secret'
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, snapshotsInserted: 6 }),
    } as Response)
    const out = await seedTournamentViaLegacy({ tournamentId: 't1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://padelnachos.com/api/ops/seed-fip-entry-list')
    expect((init as RequestInit).method).toBe('POST')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Cookie).toBe('ops_token=test-secret')
    expect(out.ok).toBe(true)
  })

  it('returns the upstream error body when the legacy call fails', async () => {
    process.env.OPS_PUBLIC_APP_URL = 'https://padelnachos.com'
    process.env.CRON_SECRET = 'test-secret'
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: 'fip page 404' }),
    } as Response)
    const out = await seedTournamentViaLegacy({ tournamentId: 't1' })
    expect(out.ok).toBe(false)
    expect(out.error).toBe('fip page 404')
  })
})
