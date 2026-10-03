import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), upload: vi.fn(), update: vi.fn(), remove: vi.fn(), lookup: vi.fn(), save: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/supabase', () => ({ serviceClient: () => ({
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: mocks.lookup }) }),
    update: mocks.update,
  }),
  storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove,
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.com/coach-avatars/${path}` } }),
  }) },
}) }))
import { POST } from '../route'
const ID = '77ab6a3d-7484-46d2-b873-f90df0a4a1a0'

function request(file?: File, coachId = ID): Request {
  const form = new FormData()
  form.set('coachId', coachId)
  if (file) form.set('file', file)
  return new Request('http://localhost/api/internal/upload-coach-avatar', { method: 'POST', body: form })
}
async function photo(): Promise<File> {
  const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#ffcc00' } }).png().toBuffer()
  return new File([new Uint8Array(bytes)], 'coach.png', { type: 'image/png' })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { isOperator: true } })
  mocks.upload.mockResolvedValue({ error: null })
  mocks.remove.mockResolvedValue({ error: null })
  mocks.lookup.mockResolvedValue({ data: { id: ID, status: 'verified' }, error: null })
  mocks.save.mockResolvedValue({ data: { id: ID }, error: null })
  mocks.update.mockReturnValue({ eq: (field: string, id: string) => {
    expect([field, id]).toEqual(['id', ID])
    return { neq: (field: string, status: string) => {
      expect([field, status]).toEqual(['status', 'merged'])
      return { select: () => ({ maybeSingle: mocks.save }) }
    } }
  } })
})

describe('coach avatar upload', () => {
  it('requires operator access', async () => {
    mocks.auth.mockResolvedValue({ user: { isOperator: false } })
    expect((await POST(request())).status).toBe(401)
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('rejects malformed coach IDs and multipart requests', async () => {
    expect((await POST(request(undefined, 'invalid'))).status).toBe(400)
    expect((await POST(new Request('http://localhost', { method: 'POST', body: 'bad' }))).status).toBe(400)
  })
  it('rejects missing, empty, oversized and unsupported files', async () => {
    const files = [undefined,
      new File([], 'a.png', { type: 'image/png' }),
      new File([new Uint8Array(2097153)], 'a.png', { type: 'image/png' }),
      new File(['data'], 'a.svg', { type: 'image/svg+xml' }),
    ]
    for (const file of files) expect((await POST(request(file))).status).toBe(400)
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('rejects unknown and merged coaches', async () => {
    mocks.lookup.mockResolvedValue({ data: null, error: null })
    expect((await POST(request(await photo()))).status).toBe(404)
    mocks.lookup.mockResolvedValue({ data: { id: ID, status: 'merged' }, error: null })
    expect((await POST(request(await photo()))).status).toBe(409)
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('reports lookup errors', async () => {
    mocks.lookup.mockResolvedValue({ data: null, error: { message: 'failed' } })
    expect((await POST(request(await photo()))).status).toBe(500)
  })
  it('rejects corrupt images even when the MIME type claims PNG', async () => {
    expect((await POST(request(new File(['not an image'], 'a.png', { type: 'image/png' })))).status).toBe(400)
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('saves a resized image and durable URL on the existing coach', async () => {
    const res = await POST(request(await photo()))
    expect(res.status).toBe(200)
    const { url } = await res.json()
    expect(url).toContain(`/coach-avatars/${ID}/`)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ avatar_url: url }))
    expect(await sharp(mocks.upload.mock.calls[0][1]).metadata()).toMatchObject({ format: 'webp', width: 512, height: 384 })
  })
  it('uses a fresh URL for replacements', async () => {
    const first = await (await POST(request(await photo()))).json()
    const second = await (await POST(request(await photo()))).json()
    expect(second.url).not.toBe(first.url)
  })
  it('preserves the saved photo when storage fails', async () => {
    mocks.upload.mockResolvedValue({ error: { message: 'failed' } })
    expect((await POST(request(await photo()))).status).toBe(500)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('cleans up the new upload if saving fails or the coach was merged during upload', async () => {
    for (const result of [{ data: null, error: { message: 'failed' } }, { data: null, error: null }]) {
      mocks.save.mockResolvedValue(result)
      expect((await POST(request(await photo()))).status).toBe(500)
      expect(mocks.remove).toHaveBeenLastCalledWith([mocks.upload.mock.calls.at(-1)![0]])
    }
  })
})
