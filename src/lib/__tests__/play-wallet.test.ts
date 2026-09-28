import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ access: vi.fn(), season: vi.fn() }))
vi.mock('@/lib/play-access', () => ({ requirePlayAccess: mock.access }))
vi.mock('@/app/api/play/_shared', () => ({ getActiveSeason: mock.season }))
import { GET } from '@/app/api/play/wallet/route'
beforeEach(() => { vi.resetAllMocks() })
it('does not return a wallet without Play access', async () => {
  mock.access.mockResolvedValue(null)
  const response = await GET()
  expect(await response.json()).toEqual({ allowed: false })
  expect(mock.season).not.toHaveBeenCalled()
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})
it('scopes the balance to the authenticated user and active season', async () => {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { balance: 8684 }, error: null }) }
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query)
  mock.access.mockResolvedValue({ userId: 'current-user', supabase: { from: vi.fn().mockReturnValue(query) } })
  mock.season.mockResolvedValue({ id: 'current-season' })
  expect(await (await GET()).json()).toEqual({ allowed: true, balance: 8684 })
  expect(query.eq.mock.calls).toEqual([['user_id', 'current-user'], ['season_id', 'current-season']])
})
it('does not invent a balance when no season exists', async () => {
  mock.access.mockResolvedValue({ userId: 'current-user', supabase: {} })
  mock.season.mockResolvedValue(null)
  expect(await (await GET()).json()).toEqual({ allowed: true, balance: null })
})
it('does not present a query failure as a zero balance', async () => {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'offline' } }) }
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query)
  mock.access.mockResolvedValue({ userId: 'current-user', supabase: { from: vi.fn().mockReturnValue(query) } })
  mock.season.mockResolvedValue({ id: 'current-season' })
  expect((await GET()).status).toBe(503)
})
