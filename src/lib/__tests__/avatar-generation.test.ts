import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateAvatar, isLocalAvatarRequest } from '../avatar-generation'
const png = Buffer.from([137,80,78,71,13,10,26,10])
afterEach(() => vi.unstubAllEnvs())
describe('photo avatar generation', () => {
  it('uses two ordered image references and keeps the key in a server request header', async () => {
    let request: RequestInit | undefined
    const fetcher = vi.fn(async (_url, init) => { request = init; return Response.json({ data: [{ b64_json: png.toString('base64') }] }) })
    const image = await generateAvatar(new Blob(['person']), new Blob(['style']), 'test-key', fetcher)
    expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/edits')
    expect(request?.headers).toEqual({ Authorization: 'Bearer test-key' })
    const body = request?.body as FormData
    const files = body.getAll('image[]') as File[]
    expect(await files[0].text()).toBe('person')
    expect(await files[1].text()).toBe('style')
    expect(body.get('model')).toBe('gpt-image-2')
    expect(body.has('input_fidelity')).toBe(false)
    expect(Buffer.from(image)).toEqual(png)
  })
  it('maps provider failures without exposing private upstream text', async () => {
    const fetcher = vi.fn(async () => new Response('private details', { status: 429 }))
    await expect(generateAvatar(new Blob(), new Blob(), 'test', fetcher)).rejects.toMatchObject({ code: 'provider_busy', status: 429 })
  })
  it('rejects missing or non-image outputs', async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ b64_json: Buffer.from('<html>not image</html>').toString('base64') }] }))
    await expect(generateAvatar(new Blob(), new Blob(), 'test', fetcher)).rejects.toMatchObject({ code: 'generation_failed' })
  })
  it('fails closed outside a local development request', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(isLocalAvatarRequest(new Request('http://localhost:3012/api/play/avatar'))).toBe(true)
    expect(isLocalAvatarRequest(new Request('https://localhost.evil.test/api/play/avatar'))).toBe(false)
    vi.stubEnv('NODE_ENV', 'production')
    expect(isLocalAvatarRequest(new Request('http://localhost:3012/api/play/avatar'))).toBe(false)
  })
})
