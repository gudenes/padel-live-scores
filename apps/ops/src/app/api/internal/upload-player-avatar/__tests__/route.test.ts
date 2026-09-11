// apps/ops/src/app/api/internal/upload-player-avatar/__tests__/route.test.ts
// Operator avatar upload, restricted to amateur players.
//
// Auth.js and the Supabase service client are mocked. The Supabase mock
// exposes both the `players` tier lookup and the storage upload, so each
// test can drive one of them.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, serviceClientMock, tierResult, uploadResult } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
  tierResult: { value: { data: { tier: 'amateur' }, error: null } as unknown },
  uploadResult: { value: { error: null } as unknown },
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))

import { POST } from '../route'

const PLAYER_ID = '77ab6a3d-7484-46d2-b873-f90df0a4a1a0'

function formWith(file: File | null, playerId: string = PLAYER_ID): Request {
  const form = new FormData()
  if (file) form.set('file', file)
  form.set('playerId', playerId)
  return new Request('http://localhost/api/internal/upload-player-avatar', {
    method: 'POST',
    body: form,
  })
}

function pngOf(bytes: number): File {
  return new File([new Uint8Array(bytes)], 'photo.png', { type: 'image/png' })
}

beforeEach(() => {
  authMock.mockResolvedValue({ user: { isOperator: true } })
  tierResult.value = { data: { tier: 'amateur' }, error: null }
  uploadResult.value = { error: null }
  serviceClientMock.mockReturnValue({
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve(tierResult.value) }) }),
    }),
    storage: {
      from: () => ({ upload: () => Promise.resolve(uploadResult.value) }),
    },
  })
})

describe('POST /api/internal/upload-player-avatar', () => {
  it('rejects a caller who is not an operator', async () => {
    authMock.mockResolvedValue(null)
    const res = await POST(formWith(pngOf(10)))
    expect(res.status).toBe(401)
  })

  it('rejects a professional player', async () => {
    tierResult.value = { data: { tier: 'pro' }, error: null }
    const res = await POST(formWith(pngOf(10)))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/amateur/i)
  })

  it('rejects a player that does not exist', async () => {
    tierResult.value = { data: null, error: null }
    const res = await POST(formWith(pngOf(10)))
    expect(res.status).toBe(404)
  })

  it('rejects an unsupported file type', async () => {
    const gif = new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' })
    const res = await POST(formWith(gif))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/type/i)
  })

  it('rejects a file over 2 MB', async () => {
    const res = await POST(formWith(pngOf(2 * 1024 * 1024 + 1)))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/large/i)
  })

  it('rejects a playerId that is not a uuid', async () => {
    const res = await POST(formWith(pngOf(10), 'not-a-uuid'))
    expect(res.status).toBe(400)
  })

  it('returns a cache-busted public url on success', async () => {
    const res = await POST(formWith(pngOf(10)))
    expect(res.status).toBe(200)
    const { url } = await res.json()
    // The storage key is stable per player, so without ?v= the CDN would keep
    // serving the previous photo.
    expect(url).toContain(`/avatars/${PLAYER_ID}.png`)
    expect(url).toMatch(/\?v=\d+$/)
  })

  it('surfaces a storage failure as a 500', async () => {
    uploadResult.value = { error: { message: 'boom' } }
    const res = await POST(formWith(pngOf(10)))
    expect(res.status).toBe(500)
  })
})
