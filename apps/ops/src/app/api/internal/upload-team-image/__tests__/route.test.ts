// apps/ops/src/app/api/internal/upload-team-image/__tests__/route.test.ts
// Cover and crest upload for a team. Mirrors upload-equipment-image: validate,
// store, return a URL — the DB write is the caller's PATCH.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, serviceClientMock, uploadResult } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
  uploadResult: { value: { error: null } as unknown },
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))

import { POST } from '../route'

const TEAM_ID = '11111111-2222-3333-4444-555555555555'

function form(file: File | null, kind = 'cover', teamId = TEAM_ID): Request {
  const f = new FormData()
  if (file) f.set('file', file)
  f.set('kind', kind)
  f.set('teamId', teamId)
  return new Request('http://localhost/api/internal/upload-team-image', { method: 'POST', body: f })
}

const png = (bytes: number) => new File([new Uint8Array(bytes)], 'a.png', { type: 'image/png' })

beforeEach(() => {
  authMock.mockResolvedValue({ user: { isOperator: true } })
  uploadResult.value = { error: null }
  serviceClientMock.mockReturnValue({
    storage: {
      createBucket: () => Promise.resolve({ error: null }),
      from: () => ({ upload: () => Promise.resolve(uploadResult.value) }),
    },
  })
})

describe('POST /api/internal/upload-team-image', () => {
  it('rejects a caller who is not an operator', async () => {
    authMock.mockResolvedValue(null)
    expect((await POST(form(png(10)))).status).toBe(401)
  })

  it('rejects an unknown kind', async () => {
    const res = await POST(form(png(10), 'mascot'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/kind/i)
  })

  it('rejects a teamId that is not a uuid', async () => {
    expect((await POST(form(png(10), 'cover', 'nope'))).status).toBe(400)
  })

  it('rejects an unsupported file type', async () => {
    const gif = new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' })
    const res = await POST(form(gif))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/type/i)
  })

  it('rejects a file over 2 MB', async () => {
    const res = await POST(form(png(2 * 1024 * 1024 + 1)))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/large/i)
  })

  it('returns a cache-busted url keyed by kind and team', async () => {
    const res = await POST(form(png(10), 'crest'))
    expect(res.status).toBe(200)
    const { url } = await res.json()
    // Key is stable per team AND kind, so without ?v= a replacement image
    // would stay masked by the CDN.
    expect(url).toContain(`/teams/crest-${TEAM_ID}.png`)
    expect(url).toMatch(/\?v=\d+$/)
  })

  it('surfaces a storage failure as a 500', async () => {
    uploadResult.value = { error: { message: 'boom' } }
    expect((await POST(form(png(10)))).status).toBe(500)
  })
})
