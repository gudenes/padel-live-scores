import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: mock.auth }))
import { GET } from '../route'
import { verifyScoutingProof } from '@/lib/scouting-extension-auth'
const id = 'a'.repeat(32), origin = 'chrome-extension://' + id
const request = (extensionId = id, caller?: string) => new Request('https://admin.test/api/internal/scouting-extension/session?extensionId=' + extensionId, { headers: caller ? { origin: caller } : {} })
beforeEach(() => { vi.stubEnv('AUTH_SECRET', 'test-secret'); mock.auth.mockResolvedValue({ user: { id: 'operator', email: 'test@example.com', isOperator: true } }) })
afterEach(() => vi.unstubAllEnvs())
it('issues a no-store proof only to an authenticated operator', async () => {
  const result = await GET(request()), data = await result.json()
  expect(result.headers.get('cache-control')).toBe('no-store')
  expect(verifyScoutingProof(data.token, 'operator', origin)).toBe(true)
  expect(data.email).toBe('test@example.com')
  mock.auth.mockResolvedValue(null)
  expect((await GET(request())).status).toBe(401)
  mock.auth.mockResolvedValue({ user: { id: 'viewer', isOperator: false } })
  expect((await GET(request())).status).toBe(403)
})
it('rejects website callers, malformed IDs and unavailable signing configuration', async () => {
  expect((await GET(request(id, 'https://evil.test'))).status).toBe(400)
  expect((await GET(request('invalid'))).status).toBe(400)
  vi.stubEnv('AUTH_SECRET', '')
  expect((await GET(request())).status).toBe(503)
})
