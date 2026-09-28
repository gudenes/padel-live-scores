import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
const mocks = vi.hoisted(() => ({ access: vi.fn(), generate: vi.fn(), reserve: vi.fn(), save: vi.fn(), release: vi.fn(), settings: vi.fn() }))
vi.mock('@/lib/local-avatar-settings', () => ({ readAvatarSettings: mocks.settings }))
vi.mock('@/lib/play-access', () => ({ requirePlayAccess: mocks.access }))
vi.mock('@/lib/avatar-local-store', () => ({ reserveAvatarGeneration: mocks.reserve, saveLocalAvatar: mocks.save }))
vi.mock('@/lib/avatar-generation', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/avatar-generation')>(), generateAvatar: mocks.generate }))
import { GET, POST } from './route'
const url = 'http://localhost:3012/api/play/avatar'
function request(form = new FormData(), origin = 'http://localhost:3012') { return new Request(url, { method: 'POST', headers: { origin }, body: form }) }
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('OPENAI_API_KEY', 'test-key')
  vi.clearAllMocks(); mocks.settings.mockResolvedValue({enabled:true,apiKey:'test-key'}); mocks.access.mockResolvedValue({ userId: 'alice' }); mocks.reserve.mockResolvedValue(mocks.release)
  mocks.generate.mockResolvedValue(new Uint8Array([137,80,78,71,13,10,26,10]))
  mocks.save.mockResolvedValue('20fca730-15c5-4e54-ab12-b2e34e2fd913')
})
afterEach(() => vi.unstubAllEnvs())
describe('private local photo route', () => {
  it('reports setup without returning the key', async () => {
    mocks.settings.mockResolvedValue({enabled:false,apiKey:null})
    expect(await (await GET(new Request(url))).json()).toEqual({ enabled: false, dailyLimit: 5 })
    expect((await POST(request())).status).toBe(503)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('requires same origin, access, and consent before any provider request', async () => {
    expect((await POST(request(undefined, 'https://other.test'))).status).toBe(403)
    mocks.access.mockResolvedValueOnce(null)
    expect((await POST(request())).status).toBe(404)
    expect((await POST(request())).status).toBe(400)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('rejects malformed photos and oversized streamed bodies', async () => {
    const form = new FormData(); form.set('consent','true'); form.set('photo',new Blob(['invalid'],{type:'image/png'}),'photo.png')
    expect((await POST(request(form))).status).toBe(400)
    const oversized = new Request(url, { method: 'POST', headers: { origin: 'http://localhost:3012', 'content-type': 'multipart/form-data; boundary=test' }, body: new Uint8Array(7*1024*1024) })
    expect((await POST(oversized)).status).toBe(413)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('normalizes a valid photo, creates a private preview, and releases the lock', async () => {
    const image = await sharp({create:{width:32,height:32,channels:3,background:'#eee'}}).png().toBuffer()
    const form = new FormData();form.set('consent','true');form.set('photo',new Blob([new Uint8Array(image)],{type:'image/png'}),'personal-name.png')
    const response = await POST(request(form))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({outfit:'custom:20fca730-15c5-4e54-ab12-b2e34e2fd913'})
    expect(mocks.generate.mock.calls[0][0].type).toBe('image/jpeg')
    expect(mocks.save.mock.calls[0][0]).toBe('alice')
    expect(mocks.release).toHaveBeenCalledOnce()
  })
  it('releases the lock on provider failure', async () => {
    mocks.generate.mockRejectedValueOnce(new Error('private provider details'))
    const image=await sharp({create:{width:1,height:1,channels:3,background:'#eee'}}).jpeg().toBuffer()
    const form=new FormData();form.set('consent','true');form.set('photo',new Blob([new Uint8Array(image)],{type:'image/jpeg'}),'a.jpg')
    const response=await POST(request(form))
    expect(await response.json()).toEqual({error:'generation_failed'})
    expect(mocks.release).toHaveBeenCalledOnce()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
