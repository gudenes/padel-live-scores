import { it, expect, vi, beforeEach } from 'vitest'
const m = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), rpc: vi.fn() }))
vi.mock('../../_auth', () => ({ getUserOrFail: m.auth }))
vi.mock('@/lib/play-write-origin', () => ({ isTrustedPlayWrite: m.origin }))
import { POST } from '../route'
beforeEach(() => {
  vi.clearAllMocks()
  m.origin.mockReturnValue(true)
  m.auth.mockResolvedValue({
    user: { id: 'current' },
    error: null,
    supabase: { rpc: m.rpc },
  })
  m.rpc.mockResolvedValue({ error: null })
})
it('requires authentication', async () => {
  m.auth.mockResolvedValue({ error: new Response(null, { status: 401 }) })
  expect(
    (await POST(new Request('https://padelnachos.com/api/user/app-presence')))
      .status
  ).toBe(401)
  expect(m.rpc).not.toHaveBeenCalled()
})
it('rejects cross-origin calls', async () => {
  m.origin.mockReturnValue(false)
  expect(
    (await POST(new Request('https://padelnachos.com/api/user/app-presence')))
      .status
  ).toBe(403)
  expect(m.rpc).not.toHaveBeenCalled()
})
it('uses server-owned RPC for current user and ignores spoofed timestamps/IDs', async () => {
  const r = await POST(
    new Request('https://padelnachos.com/api/user/app-presence', {
      method: 'POST',
      body: JSON.stringify({ id: 'other', last_seen_at: '2099-01-01' }),
    })
  )
  expect(r.status).toBe(200)
  expect(m.rpc).toHaveBeenCalledWith('record_app_foreground', {
    p_user: 'current',
  })
})
it('database failures cannot claim activity was saved', async () => {
  m.rpc.mockResolvedValue({ error: { message: 'offline' } })
  expect(
    (await POST(new Request('https://padelnachos.com/api/user/app-presence')))
      .status
  ).toBe(503)
})
