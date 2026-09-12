// apps/ops/src/app/api/internal/team/[id]/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, serviceClientMock, updateSpy } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
  updateSpy: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))

import { PATCH } from '../route'

const TEAM_ID = '11111111-2222-3333-4444-555555555555'
const params = Promise.resolve({ id: TEAM_ID })

function patch(body: unknown): Request {
  return new Request(`http://localhost/api/internal/team/${TEAM_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  authMock.mockResolvedValue({ user: { isOperator: true } })
  updateSpy.mockReset()
  serviceClientMock.mockReturnValue({
    from: () => ({
      update: (payload: unknown) => { updateSpy(payload); return { eq: () => Promise.resolve({ error: null }) } },
    }),
  })
})

describe('PATCH /api/internal/team/[id]', () => {
  it('rejects a caller who is not an operator', async () => {
    authMock.mockResolvedValue(null)
    expect((await PATCH(patch({ city: 'Mataró' }), { params })).status).toBe(401)
  })

  it('rejects a field outside the allow-list', async () => {
    // Failing loudly beats silently dropping the field — a silent drop looks
    // like a save that worked.
    const res = await PATCH(patch({ slug: 'hijacked' }), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/slug/)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('writes the allow-listed fields', async () => {
    const res = await PATCH(patch({ city: 'Mataró', country: 'ES', short_name: 'SNP' }), { params })
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith({ city: 'Mataró', country: 'ES', short_name: 'SNP' })
  })
})
