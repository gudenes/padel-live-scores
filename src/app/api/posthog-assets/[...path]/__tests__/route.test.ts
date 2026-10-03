import { afterEach, expect, it, vi } from 'vitest'
import { GET } from '../route'
afterEach(() => vi.unstubAllGlobals())
const request = new Request('https://padelnachos.com/ingest/static/posthog-recorder.js?v=1.372.1', { headers: { cookie: 'private', 'cf-connecting-ip': '192.0.2.1' } })
it('loads recorder without forwarding visitor or Cloudflare headers', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('recorder', { headers: { 'content-type': 'application/javascript', 'set-cookie': 'unwanted' } }))
  vi.stubGlobal('fetch', fetchMock)
  const response = await GET(request, { params: Promise.resolve({ path: ['posthog-recorder.js'] }) })
  expect(await response.text()).toBe('recorder')
  expect(String(fetchMock.mock.calls[0][0])).toBe('https://eu-assets.i.posthog.com/static/posthog-recorder.js?v=1.372.1')
  expect(fetchMock.mock.calls[0][1].headers).toEqual({ Accept: '*/*' })
  expect(response.headers.has('set-cookie')).toBe(false)
})
it('rejects paths outside the public asset directory', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
  expect((await GET(request, { params: Promise.resolve({ path: ['..', 'secret'] }) })).status).toBe(404)
  expect(fetchMock).not.toHaveBeenCalled()
})
it('does not cache upstream failures', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('blocked', {status:403})))
  const r = await GET(request, { params: Promise.resolve({ path: ['posthog-recorder.js'] }) })
  expect(r.status).toBe(502)
  expect(r.headers.get('cache-control')).toBe('no-store')
})
