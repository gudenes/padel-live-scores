import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { auth, command } = vi.hoisted(() => ({ auth: vi.fn(), command: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth }))
vi.mock('@/lib/play-simulation', () => ({ simulationCommand: command }))
import { GET, POST } from '../route'
const url = 'http://localhost:3014/api/internal/play-simulation'
function request(body: unknown, origin = 'http://localhost:3014') {
  return new Request(url, { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
beforeEach(() => { vi.stubEnv('NODE_ENV', 'development'); auth.mockResolvedValue({ user: { isOperator: true } }); command.mockResolvedValue({ paused: 1 }) })
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
describe('local simulation controls', () => {
  it('requires operator authentication', async () => { auth.mockResolvedValue(null); expect((await GET(new Request(url))).status).toBe(401); expect(command).not.toHaveBeenCalled() })
  it('blocks production and remote hosts', async () => {
    vi.stubEnv('NODE_ENV', 'production'); expect((await GET(new Request(url))).status).toBe(403)
    vi.stubEnv('NODE_ENV', 'development'); expect((await GET(new Request('http://example.com/api/internal/play-simulation'))).status).toBe(403)
    expect(command).not.toHaveBeenCalled()
  })
  it('rejects cross-origin writes', async () => { expect((await POST(request({ action: 'resume' }, 'https://elsewhere.com'))).status).toBe(403); expect(command).not.toHaveBeenCalled() })
  it('validates settings before dispatch', async () => {
    for (const body of [{ action: 'configure', count: 1001, intervalSeconds: 15 }, { action: 'configure', count: 50, intervalSeconds: 0 }, { action: 'run' }]) expect((await POST(request(body))).status).toBe(400)
    expect(command).not.toHaveBeenCalled()
  })
  it('saves settings through fixed command arguments', async () => {
    expect((await POST(request({ action: 'configure', count: 100, intervalSeconds: 30 }))).status).toBe(200)
    expect(command).toHaveBeenNthCalledWith(1, ['configure', '100', '30000'])
    expect(command).toHaveBeenNthCalledWith(2, ['admin-state'])
  })
  it('reports failures without claiming success', async () => { command.mockRejectedValueOnce(new Error('failure')); expect((await POST(request({ action: 'pause' }))).status).toBe(503) })
})
